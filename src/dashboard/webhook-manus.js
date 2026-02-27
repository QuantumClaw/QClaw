/**
 * Manus Webhook Handler
 * 
 * Receives notifications when Manus completes jobs.
 * Echo reviews the output and notifies Hayley.
 */

import { log } from '../core/logger.js';

export function setupManusWebhook(dashboardServer) {
  const { app, qclaw } = dashboardServer;

  // Webhook endpoint for Manus
  app.post('/webhook/manus', async (req, res) => {
    try {
      const { job_id, status, output_url, artifacts, summary, error } = req.body;

      // Log to audit trail
      qclaw.audit.log('webhook', 'manus_notification', job_id, {
        status,
        output_url,
        artifacts,
        summary,
        error,
        timestamp: new Date().toISOString()
      });

      log.info(`[MANUS] Job ${job_id} → ${status}`);

      // Acknowledge receipt immediately
      res.json({ ok: true, job_id, received: new Date().toISOString() });

      // Process asynchronously
      setImmediate(async () => {
        try {
          await handleManusCompletion(qclaw, {
            job_id,
            status,
            output_url,
            artifacts,
            summary,
            error
          });
        } catch (err) {
          log.error(`[MANUS] Handler error: ${err.message}`);
        }
      });

    } catch (err) {
      log.error(`[MANUS] Webhook error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  log.success('Manus webhook endpoint: POST /webhook/manus');
}

/**
 * Handle completed Manus job
 */
async function handleManusCompletion(qclaw, data) {
  const { job_id, status, output_url, artifacts, summary, error } = data;

  let message = `🏗️ **Manus Job Complete**\n\n`;
  message += `**Job ID:** ${job_id}\n`;
  message += `**Status:** ${status}\n`;

  if (status === 'completed') {
    message += `**Summary:** ${summary || 'No summary provided'}\n`;
    
    if (artifacts && artifacts.length > 0) {
      message += `\n**Artifacts:**\n`;
      artifacts.forEach(a => {
        message += `  • ${a.name || a.path}: ${a.type || 'file'}\n`;
      });
    }

    if (output_url) {
      message += `\n**Output:** ${output_url}\n`;
    }

    message += `\n✅ Ready for review.`;
  } else if (status === 'failed') {
    message += `\n❌ **Error:** ${error || 'Unknown error'}\n`;
  }

  // Send to Hayley via Telegram
  try {
    const telegramChannel = qclaw.channels?.channels?.find(c => 
      c.constructor.name.includes('Telegram')
    );

    if (telegramChannel && telegramChannel.sendMessage) {
      await telegramChannel.sendMessage(message, { parse_mode: 'Markdown' });
      log.success(`[MANUS] Notification sent to Telegram`);
    } else {
      log.warn(`[MANUS] No Telegram channel available for notification`);
    }
  } catch (err) {
    log.error(`[MANUS] Failed to send notification: ${err.message}`);
  }

  // Broadcast to dashboard WebSocket clients
  if (qclaw.dashboardServer?.broadcast) {
    qclaw.dashboardServer.broadcast({
      type: 'manus_job',
      ...data,
      timestamp: new Date().toISOString()
    });
  }

  // TODO: Add auto-review logic here
  // - Download artifacts
  // - Run basic tests
  // - Check for common issues
  // - Auto-deploy if safe
}
