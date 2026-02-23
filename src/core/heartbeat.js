/**
 * QuantumClaw Heartbeat
 *
 * Four modes:
 * 1. SCHEDULED: Cron jobs (morning briefs, weekly reviews)
 * 2. EVENT-DRIVEN: React to webhooks, missed calls, new leads
 * 3. GRAPH-DRIVEN: Traverse knowledge graph for patterns (opt-in, costs money)
 * 4. AUTO-LEARN: Proactively ask the user about themselves/business (opt-in)
 */

import { log } from '../core/logger.js';

// Discovery question templates — contextual, short, useful
const LEARN_PROMPTS = [
  // Business fundamentals
  'What are you working on this week?',
  'What\'s the biggest challenge in your business right now?',
  'Who are your main clients or customers?',
  'What tools or platforms do you use daily?',
  'What does a typical workday look like for you?',
  // Goals & priorities
  'What are your top 3 priorities this month?',
  'Is there anything you wish you could automate?',
  'What would save you the most time right now?',
  'What\'s a recent win you\'re proud of?',
  'What part of your business do you want to grow next?',
  // Preferences
  'How do you prefer to be communicated with — brief or detailed?',
  'What time of day are you most productive?',
  'Are there any topics or tasks you\'d never want me to handle?',
  'What\'s your preferred way to handle deadlines?',
  'Do you work mostly alone or with a team?',
];

export class Heartbeat {
  constructor(config, agents, memory, audit) {
    this.config = config;
    this.agents = agents;
    this.memory = memory;
    this.audit = audit || null;
    this.timers = [];
    this.running = false;
    this.heartbeatCostToday = 0;
    this._learnQuestionsToday = 0;
    this._lastLearnTime = 0;
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

    // Auto-learn — OFF by default. User opts in via CLI or dashboard.
    // Proactively asks the user contextual questions to learn about them faster.
    if (heartbeatConfig.autoLearn?.enabled === true) {
      this._startAutoLearn(heartbeatConfig.autoLearn);
      log.info('Heartbeat: auto-learn enabled');
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
      this._learnQuestionsToday = 0;
    }, 24 * 60 * 60 * 1000);
    this.timers.push(resetTimer);
  }

  /**
   * Auto-Learn: proactively ask the user about themselves and their business.
   *
   * Design principles:
   * - Only stores the ANSWER, not the question (no bloat)
   * - Uses fast/free model for question generation (not primary)
   * - Respects quiet hours (no 3am pings)
   * - Hard cap: maxQuestionsPerDay (default 3), minIntervalHours (default 4)
   * - Questions are contextual — pulls recent memory to ask relevant follow-ups
   * - Costs near-zero on Groq free tier
   *
   * Memory impact analysis:
   *   - Each answer: ~200 chars stored in SQLite + vector index
   *   - 3 answers/day × 365 days = 1,095 entries = ~220KB in SQLite
   *   - Vector store caps at 5,000 docs (auto-prunes oldest)
   *   - Context window: only last 20 messages loaded (getHistory limit)
   *   - On Termux/Android: JSON fallback caps at 500 messages total
   *   - Net memory growth: negligible. Will never bloat.
   */
  _startAutoLearn(learnConfig) {
    const maxPerDay = learnConfig.maxQuestionsPerDay || 3;
    const minIntervalMs = (learnConfig.minIntervalHours || 4) * 60 * 60 * 1000;
    const quietStart = learnConfig.quietHoursStart ?? 22;
    const quietEnd = learnConfig.quietHoursEnd ?? 8;
    const useFast = learnConfig.useFastModel !== false;

    // Check every 30 minutes if it's time to ask
    const timer = setInterval(async () => {
      if (!this.running) return;

      // Daily cap
      if (this._learnQuestionsToday >= maxPerDay) return;

      // Minimum interval between questions
      if (Date.now() - this._lastLearnTime < minIntervalMs) return;

      // Quiet hours
      const hour = new Date().getHours();
      if (quietStart > quietEnd) {
        // Wraps midnight: e.g. 22-8 means quiet from 22:00 to 08:00
        if (hour >= quietStart || hour < quietEnd) return;
      } else {
        if (hour >= quietStart && hour < quietEnd) return;
      }

      // Cost cap
      const maxDailyCost = this.config.heartbeat?.maxDailyCost || 0.50;
      if (this.heartbeatCostToday >= maxDailyCost) return;

      try {
        await this._askLearnQuestion(useFast);
      } catch (err) {
        log.debug(`Auto-learn failed: ${err.message}`);
      }
    }, 30 * 60 * 1000); // every 30 min

    this.timers.push(timer);

    // Also try once shortly after boot (5 min delay)
    const bootTimer = setTimeout(async () => {
      if (!this.running) return;
      if (this._learnQuestionsToday >= maxPerDay) return;

      const hour = new Date().getHours();
      if (quietStart > quietEnd) {
        if (hour >= quietStart || hour < quietEnd) return;
      } else {
        if (hour >= quietStart && hour < quietEnd) return;
      }

      try {
        await this._askLearnQuestion(useFast);
      } catch (err) {
        log.debug(`Auto-learn (boot) failed: ${err.message}`);
      }
    }, 5 * 60 * 1000);

    this.timers.push(bootTimer);
  }

  async _askLearnQuestion(useFast) {
    const agent = this.agents.primary();
    if (!agent) return;

    // Pick a question — contextual if we have recent memory, random otherwise
    let question;
    try {
      const recent = this.memory.getHistory('echo', 10);
      const recentText = recent.map(m => m.content).join(' ').slice(0, 500);

      if (recentText.length > 50) {
        // Generate a contextual follow-up question using the fast model
        const result = await agent.services.router.complete([
          { role: 'system', content: 'You are a concise assistant. Generate exactly ONE short follow-up question (max 15 words) to learn more about this person and their business based on recent conversation context. Just output the question, nothing else.' },
          { role: 'user', content: `Recent context: ${recentText}\n\nGenerate one follow-up question:` }
        ], { model: useFast ? agent.services.router.fast : agent.services.router.primary, maxTokens: 50 });

        this.heartbeatCostToday += result.cost || 0;
        question = result.content?.trim();
      }
    } catch {
      // Fall through to random question
    }

    // Fallback to random template if contextual generation failed
    if (!question || question.length < 5 || question.length > 200) {
      // Pick a question we haven't asked recently
      const asked = this.memory.getContext('autolearn_asked') || [];
      const available = LEARN_PROMPTS.filter((_, i) => !asked.includes(i));
      const pool = available.length > 0 ? available : LEARN_PROMPTS;
      const idx = LEARN_PROMPTS.indexOf(pool[Math.floor(Math.random() * pool.length)]);
      question = LEARN_PROMPTS[idx];

      // Track which questions we've asked
      asked.push(idx);
      if (asked.length > LEARN_PROMPTS.length) asked.splice(0, asked.length - LEARN_PROMPTS.length);
      this.memory.setContext('autolearn_asked', asked);
    }

    // Send the question to the user via delivery queue (picked up by channels)
    const deliveryMessage = {
      type: 'autolearn',
      question,
      timestamp: Date.now(),
      agent: agent.name,
    };

    // Store in memory as a system note (not as conversation — avoids context bloat)
    this.memory.setContext('autolearn_last_question', question);
    this.memory.setContext('autolearn_last_time', Date.now());

    // Write to delivery queue for channels to pick up
    try {
      const { writeFileSync, existsSync, mkdirSync } = await import('fs');
      const { join } = await import('path');
      const queueDir = join(this.config._dir, 'workspace', 'delivery-queue');
      if (!existsSync(queueDir)) mkdirSync(queueDir, { recursive: true });
      const filename = `autolearn_${Date.now()}.json`;
      writeFileSync(join(queueDir, filename), JSON.stringify(deliveryMessage));
    } catch (err) {
      log.debug(`Auto-learn delivery write failed: ${err.message}`);
    }

    this._learnQuestionsToday++;
    this._lastLearnTime = Date.now();

    if (this.audit) {
      this.audit.log(agent.name, 'autolearn', question.slice(0, 80), {
        questionsToday: this._learnQuestionsToday,
        cost: 0,
      });
    }

    log.agent(agent.name, `Auto-learn: "${question.slice(0, 60)}..."`);
  }
}
