/**
 * QuantumClaw Heartbeat
 *
 * Three modes:
 * 1. SCHEDULED: Cron jobs (morning briefs, weekly reviews)
 * 2. EVENT-DRIVEN: React to webhooks, missed calls, new leads
 * 3. GRAPH-DRIVEN: Traverse knowledge graph for patterns (opt-in, costs money)
 */

import { log } from '../core/logger.js';

export class Heartbeat {
  constructor(config, agents, memory, audit) {
    this.config = config;
    this.agents = agents;
    this.memory = memory;
    this.audit = audit || null;
    this.timers = [];
    this.running = false;
    this.heartbeatCostToday = 0;
  }

  async start() {
    this.running = true;
    const heartbeatConfig = this.config.heartbeat || {};

    // Scheduled tasks
    if (heartbeatConfig.scheduled && heartbeatConfig.scheduled.length > 0) {
      for (const task of heartbeatConfig.scheduled) {
        this._scheduleTask(task);
      }
      log.info(`Heartbeat: ${heartbeatConfig.scheduled.length} scheduled task(s)`);
    }

    // Graph-driven discovery — OFF by default because it costs money.
    // User must explicitly set heartbeat.graphDriven: true in config.
    if (heartbeatConfig.graphDriven === true && this.memory.cogneeConnected) {
      const intervalHours = heartbeatConfig.graphDiscoveryIntervalHours || 4;
      this._startGraphDiscovery(intervalHours);
      log.info(`Heartbeat: graph discovery every ${intervalHours}h`);
    }

    log.debug('Heartbeat started');
  }

  async stop() {
    this.running = false;
    for (const timer of this.timers) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    this.timers = [];
  }

  _scheduleTask(task) {
    const intervals = {
      'every-minute': 60 * 1000,
      'every-5-minutes': 5 * 60 * 1000,
      'every-hour': 60 * 60 * 1000,
      'every-day': 24 * 60 * 60 * 1000,
    };

    const interval = intervals[task.schedule];
    if (interval) {
      const timer = setInterval(async () => {
        if (!this.running) return;

        // Daily cost cap for heartbeat (prevent runaway costs)
        const maxDailyCost = this.config.heartbeat?.maxDailyCost || 0.50;
        if (this.heartbeatCostToday >= maxDailyCost) {
          log.debug(`Heartbeat: daily cost cap reached (£${this.heartbeatCostToday.toFixed(4)}/${maxDailyCost})`);
          return;
        }

        try {
          const agent = this.agents.get(task.agent) || this.agents.primary();
          const result = await agent.process(task.prompt, { source: 'heartbeat' });
          this.heartbeatCostToday += result.cost || 0;

          log.agent(agent.name, `Heartbeat: ${task.name || task.schedule} (£${(result.cost || 0).toFixed(4)})`);

          if (this.audit) {
            this.audit.log(agent.name, 'heartbeat', task.name || task.schedule, {
              cost: result.cost,
              model: result.model,
              tier: result.tier
            });
          }
        } catch (err) {
          log.debug(`Heartbeat task failed: ${err.message}`);
        }
      }, interval);
      this.timers.push(timer);
    }
  }

  _startGraphDiscovery(intervalHours) {
    const intervalMs = intervalHours * 60 * 60 * 1000;

    const timer = setInterval(async () => {
      if (!this.running || !this.memory.cogneeConnected) return;

      // Cost cap applies to graph discovery too
      const maxDailyCost = this.config.heartbeat?.maxDailyCost || 0.50;
      if (this.heartbeatCostToday >= maxDailyCost) return;

      try {
        const queries = [
          'contacts not reached in 30 days',
          'upcoming deadlines this week',
          'relationships that might lead to opportunities'
        ];

        for (const query of queries) {
          const results = await this.memory.graphQuery(query);
          if (results.results?.length > 0) {
            const agent = this.agents.primary();
            const result = await agent.process(
              `[HEARTBEAT] Graph discovery found: ${JSON.stringify(results.results.slice(0, 3))}. Is any of this worth flagging to the owner?`,
              { source: 'heartbeat-graph' }
            );
            this.heartbeatCostToday += result.cost || 0;

            if (this.audit) {
              this.audit.log(agent.name, 'heartbeat-graph', query.slice(0, 50), {
                cost: result.cost,
                model: result.model
              });
            }
          }
        }
      } catch (err) {
        log.debug(`Graph discovery error: ${err.message}`);
      }
    }, intervalMs);

    this.timers.push(timer);

    // Reset daily cost counter at midnight
    const resetTimer = setInterval(() => {
      this.heartbeatCostToday = 0;
    }, 24 * 60 * 60 * 1000);
    this.timers.push(resetTimer);
  }
}
