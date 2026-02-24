/**
 * Detects unusual cost/usage spikes and triggers alerts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SPIKE_THRESHOLD = 2.5;
const MIN_SAMPLES = 5;

export default class SpikeDetector {
  constructor(auditLog) {
    this.auditLog = auditLog;
    this.alertFile = path.join(__dirname, '../../data/spike-alerts.json');
  }

  async detectSpikes(period = 'hour') {
    const now = Date.now();
    const periodMs = {
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000
    }[period];

    const currentStart = now - periodMs;
    const currentCosts = await this.auditLog.getCosts(currentStart, now);
    
    const historicalPeriods = [];
    for (let i = 1; i <= 7; i++) {
      const start = now - (periodMs * (i + 1));
      const end = now - (periodMs * i);
      const costs = await this.auditLog.getCosts(start, end);
      if (costs.total > 0) {
        historicalPeriods.push(costs);
      }
    }

    if (historicalPeriods.length < MIN_SAMPLES) {
      return { spike: false, reason: 'Insufficient historical data' };
    }

    const avgCost = historicalPeriods.reduce((sum, p) => sum + p.total, 0) / historicalPeriods.length;
    const avgMessages = historicalPeriods.reduce((sum, p) => sum + p.messages, 0) / historicalPeriods.length;

    const costSpike = currentCosts.total > avgCost * SPIKE_THRESHOLD;
    const messageSpike = currentCosts.messages > avgMessages * SPIKE_THRESHOLD;

    if (costSpike || messageSpike) {
      const alert = {
        timestamp: now,
        period,
        current: {
          cost: currentCosts.total,
          messages: currentCosts.messages
        },
        average: {
          cost: avgCost,
          messages: avgMessages
        },
        multiplier: {
          cost: (currentCosts.total / avgCost).toFixed(2),
          messages: (currentCosts.messages / avgMessages).toFixed(2)
        },
        type: costSpike ? 'cost' : 'usage'
      };

      await this.logAlert(alert);
      return { spike: true, alert };
    }

    return { spike: false };
  }

  async logAlert(alert) {
    let alerts = [];
    try {
      if (fs.existsSync(this.alertFile)) {
        alerts = JSON.parse(fs.readFileSync(this.alertFile, 'utf8'));
      }
    } catch (err) {
      console.error('Failed to load alerts:', err.message);
    }

    alerts.push(alert);
    
    if (alerts.length > 100) {
      alerts = alerts.slice(-100);
    }

    fs.writeFileSync(this.alertFile, JSON.stringify(alerts, null, 2));
    
    console.warn(`⚠️  SPIKE ALERT: ${alert.type} spike detected (${alert.multiplier[alert.type]}x normal)`);
  }

  async getRecentAlerts(limit = 10) {
    try {
      if (fs.existsSync(this.alertFile)) {
        const alerts = JSON.parse(fs.readFileSync(this.alertFile, 'utf8'));
        return alerts.slice(-limit).reverse();
      }
    } catch (err) {
      console.error('Failed to lalerts:', err.message);
    }
    return [];
  }
}
