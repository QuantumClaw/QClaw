/**
 * QuantumClaw Channel Manager
 *
 * Manages all input/output channels (Telegram, Discord, WhatsApp, etc.)
 * Each channel is a simple adapter: receive messages → agent → send response.
 */

import { run } from '@grammyjs/runner';
import { log } from '../core/logger.js';
import {
  bootstrap,
  clearCache as clearBootstrapCache,
  formatStatusMarkdown as formatBootstrapStatusMarkdown,
  isCached as isBootstrapCached
} from '../agents/bootstrap.js';
import { classify as classifyGrammyError, _internal as _classifierInternal } from './grammy-error-classifier.js';
import { appendFileSync, chmodSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

// Slice 3e: recovery-timer interval and cap.
const RECOVERY_TICK_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RECOVERY_ATTEMPTS = 12;        // 1 hour total before manual intervention
const MAX_RETRY_ATTEMPTS = 5;            // matches classifier's MAX_ATTEMPTS

/**
 * Slice 3e: resolve the absolute path for channel-events.log. Tests can
 * override via QCLAW_CHANNEL_EVENTS_LOG_PATH; production lives alongside
 * other ~/.quantumclaw/*.log files.
 */
function _channelEventsLogPath() {
  return process.env.QCLAW_CHANNEL_EVENTS_LOG_PATH
    || join(homedir(), '.quantumclaw', 'channel-events.log');
}

/**
 * Slice 3e: scrub any Telegram bot-token URL fragment from a string. Telegram
 * tokens are `<bot_id>:<35-char-token>`. The 2026-05-14 incident showed grammY
 * can embed the full request URL in error messages when sensitiveLogs is on.
 * This is defence-in-depth — we already exclude err.payload/err.error/err.method
 * from the log record, but any string we DO log gets scrubbed.
 */
function _scrubToken(s) {
  return String(s ?? '').replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<REDACTED>');
}

/**
 * Slice 3e: safely read a string property from an error-like value.
 * Wraps the read in try/catch so getter-throwing objects (e.g. Proxies in
 * tests, hostile error implementations) don't crash the failure handler.
 * Optionally scrubs the value for token-URL leakage and truncates to 200 chars.
 */
function _safeErrProp(err, key, fallback, scrubAndTrim) {
  try {
    if (err === null || typeof err !== 'object') return fallback;
    const v = err[key];
    if (typeof v !== 'string') return fallback;
    return scrubAndTrim ? _scrubToken(v).slice(0, 200) : v;
  } catch {
    return fallback;
  }
}

/**
 * Slice 3e: append one JSON Lines record to channel-events.log. Mode-locked to
 * 0600 on first write. Best-effort: failures are warned and swallowed so they
 * never block channel state transitions or crash the process.
 *
 * Slice 3e fixup-2 (finding 8): scrub at the WRITE boundary. Previously the
 * scrub was per-field opt-in via _safeErrProp(..., true) on `message` and
 * `description` only — error_name, network_code, and any field a future
 * contributor might add would land in the JSONL unscrubbed. Centralising the
 * scrub here makes the on-disk file unconditionally token-free regardless of
 * which call site forgets the scrub. _safeErrProp's scrub argument is kept
 * as defence-in-depth (truncates length + scrubs at read time).
 */
function _appendChannelEvent(record) {
  try {
    const path = _channelEventsLogPath();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const scrubbed = _scrubRecord({ ts: new Date().toISOString(), ...record });
    const line = JSON.stringify(scrubbed) + '\n';
    const existed = existsSync(path);
    appendFileSync(path, line);
    if (!existed) {
      try { chmodSync(path, 0o600); } catch { /* non-fatal */ }
    }
  } catch (err) {
    try { log.warn(`[ChannelManager] channel-events.log write failed: ${err.message}`); } catch { /* swallow */ }
  }
}

/**
 * Slice 3e fixup-2 (finding 8): apply _scrubToken to every string value
 * (recursively) in a record before serialisation. Non-string values pass
 * through unchanged. Single shallow level + one nested object level is
 * enough for the current event-record shape; deepens if needed.
 *
 * Slice 3e fixup-3 (finding 2): WeakSet cycle guard. Defence-in-depth —
 * no current call site builds cyclic records, but a future contributor
 * passing through e.g. an Error with a self-referencing .cause chain
 * would have stack-overflowed the previous implementation, which the
 * outer try/catch in _appendChannelEvent would have silently swallowed
 * (losing the event). On cycle detect, substitute the literal string
 * '[circular]' so the record still serialises.
 */
function _scrubRecord(record, seen = new WeakSet()) {
  if (record === null || typeof record !== 'object') return record;
  if (seen.has(record)) return '[circular]';
  seen.add(record);
  const out = Array.isArray(record) ? [] : {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === 'string') {
      out[k] = _scrubToken(v);
    } else if (v !== null && typeof v === 'object') {
      out[k] = _scrubRecord(v, seen);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Anchored at start of message. Matches "✅ 37", "✅37", "✅ 37 thanks",
// "approve 37", "yes 37", and the deny variants. Trailing chars after the
// id are kept on the message text (handler reads them as the deny reason).
export const APPROVAL_REPLY_RE = /^([✅❌]|approve|deny|yes|no)\s*#?(\d+)/i;

// Slice 3e fixup-3 (finding 2): test-only export so the cycle guard in
// _scrubRecord can be exercised directly. Same pattern as the classifier's
// _internal export. Production callers go through _appendChannelEvent.
export const _internalForTest = {
  _scrubToken,
  _scrubRecord,
};

// Extracted so it's directly testable without spinning up a Bot. The bot.hears
// callback is a thin wrapper that calls this with the approvals subsystem
// from the channel instance.
export async function handleApprovalReply(ctx, { allowedUsers, approvals }) {
  if (!allowedUsers.includes(ctx.from.id)) return;
  const verb = ctx.match[1].toLowerCase();
  const id = parseInt(ctx.match[2], 10);
  const isApprove = verb === '✅' || verb === 'approve' || verb === 'yes';
  const actor = `telegram:${ctx.from.username || ctx.from.id}`;
  const tail = ctx.message.text.slice(ctx.match[0].length).trim();

  try {
    if (isApprove) {
      const result = approvals.approve(id, actor);
      if (result?.alreadyResolved) {
        await ctx.reply(`⚠️ Approval [${id}] was already ${result.status}.`);
      } else {
        await ctx.reply(`✅ Approved [${id}].`);
        log.info(`Approval ${id} granted by ${actor} via inline reply`);
      }
    } else {
      const reason = tail || 'denied by owner';
      const result = approvals.deny(id, actor, reason);
      if (result?.alreadyResolved) {
        await ctx.reply(`⚠️ Approval [${id}] was already ${result.status}.`);
      } else {
        await ctx.reply(`❌ Denied [${id}].`);
        log.info(`Approval ${id} denied by ${actor} via inline reply: ${reason}`);
      }
    }
  } catch (e) {
    if (e.code === 'NOT_FOUND') {
      await ctx.reply(`No pending approval with ID ${id}.`);
    } else {
      await ctx.reply(`⚠️ Couldn't ${isApprove ? 'approve' : 'deny'} [${id}]: ${e.message}`);
    }
  }
}

export class ChannelManager {
  constructor(config, agents, secrets, approvals, deliveryQueue) {
    this.config = config;
    this.agents = agents;
    this.secrets = secrets;
    this.approvals = approvals;
    this.deliveryQueue = deliveryQueue;
    this.channels = [];
    this._channelsByName = new Map();
    this._broadcast = null;
  }

  /**
   * Set a broadcast callback (called after dashboard starts).
   * This lets channels send messages to the dashboard in real-time.
   */
  setBroadcast(fn) {
    this._broadcast = fn;
    // Propagate to all running channels
    for (const ch of this.channels) {
      if (ch) ch._broadcast = fn;
    }
  }

  async startAll() {
    const channelConfigs = this.config.channels || {};

    for (const [name, channelConfig] of Object.entries(channelConfigs)) {
      if (!channelConfig.enabled) continue;

      try {
        const channel = await this._createChannel(name, channelConfig);
        if (channel) {
          channel._broadcast = this._broadcast;
          await channel.start();
          this.channels.push(channel);
          this._channelsByName.set(name, channel);
          log.success(`Channel: ${name}`);
        }
      } catch (err) {
        log.warn(`Channel ${name} failed to start: ${err.message}`);
      }
    }

    if (this.deliveryQueue) {
      this.deliveryQueue.startRetryLoop(async (channel, recipient, content, metadata) => {
        const ch = this._channelsByName.get(channel);
        if (!ch || typeof ch.send !== 'function') {
          throw new Error(`Channel "${channel}" not available for delivery`);
        }
        await ch.send(recipient, content, metadata);
      });
      log.debug('Delivery queue consumer started');
    }
  }

  async stopAll() {
    if (this.deliveryQueue) {
      this.deliveryQueue.stop();
    }
    for (const channel of this.channels) {
      try {
        await channel.stop();
      } catch (err) {
        log.debug(`Channel stop error: ${err.message}`);
      }
    }
  }

  async _createChannel(name, config) {
    switch (name) {
      case 'telegram':
        return new TelegramChannel(config, this.agents, this.secrets, this.config, this.approvals);
      default:
        log.debug(`Channel "${name}" not yet implemented`);
        return null;
    }
  }
}

/**
 * Telegram Channel using grammY
 */
class TelegramChannel {
  constructor(channelConfig, agents, secrets, rootConfig, approvals) {
    this.channelConfig = channelConfig;
    this.channelConfig.channelName = 'telegram';
    this.rootConfig = rootConfig;
    this.agents = agents;
    this.secrets = secrets;
    this.approvals = approvals;
    this.bot = null;
    this._runner = null;
    this.pendingPairings = new Map();
    // Slice 1: per-(userId, agentName) flag tracking whether the
    // first-fire bootstrap warning has already surfaced in this session.
    // Cleared by /session and by clearBootstrapCache invocations.
    this.bootstrapWarningShown = new Map();

    // Slice 3e: runtime status field exposed via dashboard /api/channels.
    // 'starting' → 'active' (after run() returns) → 'retrying' / 'degraded' on
    // runner-update-loop errors → 'active' on recovery → 'stopped' on stop().
    // Init failures (getMe throws inside start()) preserve the legacy "channel
    // absent from registry" semantics — they never reach 'active' here.
    this.status = 'starting';
    this._retryAttempts = 0;
    this._recoveryAttempts = 0;
    this._backoffTimer = null;
    this._backoffTimerResolve = null;
    this._recoveryTimer = null;
    this._inFlightRecovery = false;
    // Slice 3e fixup (finding 1): captures a failure that arrives while
    // _inFlightRecovery is held. The current holder drains it on lock release
    // so the new task's rejection cannot be silently dropped.
    this._pendingFailure = null;
    this._hasPendingFailure = false;
  }

  _generatePairingCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    for (let i = 0; i < 8; i++) code += chars[bytes[i] % chars.length];
    return code;
  }

  _cleanExpiredPairings() {
    const oneHour = 60 * 60 * 1000;
    const now = Date.now();
    for (const [code, data] of this.pendingPairings) {
      if (now - data.timestamp > oneHour) this.pendingPairings.delete(code);
    }
  }

  async approvePairing(code) {
    this._cleanExpiredPairings();
    const data = this.pendingPairings.get(code.toUpperCase());
    if (!data) return null;

    const allowedUsers = this.channelConfig.allowedUsers || [];
    if (!allowedUsers.includes(data.userId)) {
      allowedUsers.push(data.userId);
      this.channelConfig.allowedUsers = allowedUsers;

      try {
        const { saveConfig } = await import('../core/config.js');
        if (this.rootConfig.channels?.telegram) {
          this.rootConfig.channels.telegram.allowedUsers = allowedUsers;
          saveConfig(this.rootConfig);
        }
      } catch {}
    }

    this.pendingPairings.delete(code.toUpperCase());
    return data;
  }
  async start() {
    const { Bot } = await import('grammy');

    const token = (await this.secrets.get('telegram_bot_token'))?.trim()
      || this.channelConfig.token
      || '';
    if (!token) throw new Error('No Telegram bot token. Re-run: qclaw onboard');

    this.bot = new Bot(token);
    const allowedUsers = this.channelConfig.allowedUsers || [];
    const dmPolicy = this.channelConfig.dmPolicy || 'pairing';

    this._registerBotHandlers(this.bot, allowedUsers, dmPolicy);

    try {
      const me = await this.bot.api.getMe();
      log.info(`Telegram bot: @${me.username} (${me.id})`);
    } catch (err) {
      throw new Error(`Telegram token invalid: ${err.message}`);
    }

    try {
      await this.bot.api.deleteWebhook({ drop_pending_updates: true });
    } catch {}

    // Use @grammyjs/runner so middleware dispatches concurrently — required so
    // bot.hears (approval-reply parser) is not blocked by a long-running
    // agent.process() in bot.on('message:text'). drop_pending_updates is
    // already handled by deleteWebhook above, so it isn't needed here.
    try {
      // Slice 3e fixup (finding 4/5): use _runBot helper so silent=true and
      // the option-shape are defined in exactly one place — start() and
      // _reinitBot must agree, and tests need to spy on the run options.
      this._runner = this._runBot(this.bot);
      this.status = 'active';
      this._wireRunnerTaskCatch();
      if (allowedUsers.length === 0) {
        log.info('Telegram: send /start to your bot to begin pairing');
      } else {
        log.success(`Telegram: ready (${allowedUsers.length} user${allowedUsers.length === 1 ? '' : 's'})`);
      }
    } catch (err) {
      // Synchronous construction failure — preserve legacy behaviour: log + null.
      // This is a pre-active failure; the registry-degradation state machine
      // applies only to post-active runtime failures.
      log.error(`Telegram polling error: ${err.message}`);
      this.bot = null;
      this._runner = null;
      throw err;
    }
  }

  /**
   * Slice 3e: wire the runner's task() promise to _onRunnerFailure. Called by
   * start() on initial wiring and by _attemptRecovery() after each successful
   * re-init. Every new _runner handle gets its own task().catch(...) — old
   * runners' tasks have already rejected and been caught by the time a new one
   * is created.
   */
  _wireRunnerTaskCatch() {
    if (!this._runner) return;
    const task = this._runner.task();
    if (task && typeof task.catch === 'function') {
      // Slice 3e fixup-2 (finding 7): outer catch on the .catch chain.
      // `task.catch(fn)` returns a new promise whose rejection (if `fn`
      // rejects) is otherwise unhandled. _onRunnerFailure is reasonably
      // defensive — every _appendChannelEvent, _safeErrProp, and classifier
      // call has an inner try/catch — but a synchronous throw that escapes
      // the body would leak as an unhandled rejection, defeating the slice's
      // primary guarantee. The outer catch is the final net: log a scrubbed
      // diagnostic line and swallow.
      task.catch((err) => this._onRunnerFailure(err))
        .catch((e) => {
          try {
            const name = (e && typeof e === 'object' && typeof e.name === 'string') ? e.name : typeof e;
            const msg = (e && typeof e === 'object' && typeof e.message === 'string')
              ? _scrubToken(e.message).slice(0, 200)
              : '';
            log.warn(`[TelegramChannel:telegram] _onRunnerFailure itself rejected (${name}): ${msg}`);
          } catch { /* last-line defence: never throw out of the wiring */ }
        });
    }
  }

  /**
   * Slice 3e: extracted from start() so _attemptRecovery() can re-register the
   * same handler set on a freshly-constructed Bot. Each re-init creates a new
   * Bot, so old listeners GC with the old Bot — no double-registration risk.
   */
  _registerBotHandlers(bot, allowedUsers, dmPolicy) {
    bot.command('start', async (ctx) => {
      const userId = ctx.from.id;
      const username = ctx.from.username || ctx.from.first_name || 'unknown';

      if (allowedUsers.includes(userId)) {
        await ctx.reply('You are already connected to QuantumClaw. Send me a message.');
        return;
      }

      if (dmPolicy === 'pairing') {
        this._cleanExpiredPairings();

        for (const [code, data] of this.pendingPairings) {
          if (data.userId === userId) {
            await ctx.reply(`Your pairing code is: ${code}\n\nEnter this in the dashboard or CLI to approve access.`);
            return;
          }
        }

        const code = this._generatePairingCode();
        this.pendingPairings.set(code, { userId, username, timestamp: Date.now() });

        await ctx.reply(`Welcome! Your pairing code is:\n\n${code}\n\nEnter this code in the dashboard or CLI to approve access.`);

        if (this._broadcast) {
          this._broadcast({
            channel: 'telegram',
            type: 'pairing_request',
            code,
            userId,
            username
          });
        }
      } else {
        await ctx.reply('DM access is currently disabled.');
      }
    });

    bot.command('pending', async (ctx) => {
      if (!allowedUsers.includes(ctx.from.id)) return;
      
      const pending = this.approvals.pending();
      if (pending.length === 0) {
        await ctx.reply('No pending approvals.');
        return;
      }
      
      let message = '🔒 *Pending Approvals:*\n\n';
      for (const item of pending) {
        message += `[${item.id}] ${item.agent} → ${item.action}\n`;
        message += `Risk: ${item.risk_level}\n`;
        message += `Detail: ${item.detail}\n`;
        message += `\n/approve ${item.id}\n\n`;
      }
      await ctx.reply(message, { parse_mode: 'Markdown' });
    });

    bot.command('approve', async (ctx) => {
      if (!allowedUsers.includes(ctx.from.id)) return;
      
      const args = ctx.message.text.split(' ');
      if (args.length < 2) {
        await ctx.reply('Usage: /approve <id>');
        return;
      }
      
      const id = parseInt(args[1]);
      if (isNaN(id)) {
        await ctx.reply('Invalid approval ID.');
        return;
      }
      
      const pending = this.approvals.pending();
      const item = pending.find(p => p.id === id);
      
      if (!item) {
        await ctx.reply(`No pending approval with ID ${id}.`);
        return;
      }
      
      const approver = `telegram:${ctx.from.username || ctx.from.id}`;
      this.approvals.approve(id, approver);
      
      await ctx.reply(`✅ Approved [${id}]: ${item.action}`);

      log.info(`Approval ${id} granted by ${approver}`);
    });

    bot.command('deny', async (ctx) => {
      if (!allowedUsers.includes(ctx.from.id)) return;
      const parts = ctx.message.text.split(/\s+/);
      if (parts.length < 2) { await ctx.reply('Usage: /deny <id> [reason]'); return; }
      const id = parseInt(parts[1], 10);
      if (isNaN(id)) { await ctx.reply('Invalid approval ID.'); return; }
      const reason = parts.slice(2).join(' ') || 'denied by owner';
      const pending = this.approvals.pending();
      const item = pending.find(p => p.id === id);
      if (!item) { await ctx.reply(`No pending approval with ID ${id}.`); return; }
      const denier = `telegram:${ctx.from.username || ctx.from.id}`;
      this.approvals.deny(id, denier, reason);
      await ctx.reply(`❌ Denied [${id}]: ${item.action}`);
      log.info(`Approval ${id} denied by ${denier}: ${reason}`);
    });

    // Slice 1: /bootstrap-status returns the cached BootstrapResult as
    // a markdown summary. If no cache exists for (userId, primary agent),
    // a fresh bootstrap is fired so the user always gets a current view.
    bot.command('bootstrap-status', async (ctx) => {
      if (allowedUsers.length > 0 && !allowedUsers.includes(ctx.from.id)) return;
      const userId = ctx.from.id;
      const agent = this.agents.primary();
      const agentName = agent?.name || 'charlie';
      try {
        const result = await bootstrap({
          userId,
          agentName,
          services: agent?.services,
          config: this.rootConfig
        });
        const md = formatBootstrapStatusMarkdown(result);
        const chunks = md.length <= 4096 ? [md] : this._chunkMessage(md, 4096);
        for (const chunk of chunks) await this._sendTelegramReply(ctx, chunk);
      } catch (err) {
        log.warn(`/bootstrap-status failed: ${err.message}`);
        await ctx.reply(`Bootstrap status error: ${err.message}`);
      }
    });

    // Slice 1: /session evicts every cached bootstrap entry for this user
    // (across all agents) and resets the warning-surfaced flag so the next
    // message will re-fire bootstrap and re-surface any warnings.
    bot.command('session', async (ctx) => {
      if (allowedUsers.length > 0 && !allowedUsers.includes(ctx.from.id)) return;
      const userId = ctx.from.id;
      clearBootstrapCache(userId);
      for (const k of [...this.bootstrapWarningShown.keys()]) {
        if (k.startsWith(`${userId}:`)) this.bootstrapWarningShown.delete(k);
      }
      await ctx.reply('Session reset. Next message triggers a fresh bootstrap.');
    });

    // Inline approval replies. Registered as bot.hears (separate handler from
    // message:text) so the runner can dispatch concurrently — emoji replies
    // are not blocked by an in-flight agent.process() call inside message:text.
    // See QCLAW_BUILD_LOG.md (2026-04-27 concurrency fix) for the deadlock
    // this addresses. handleApprovalReply is exported for unit tests.
    bot.hears(APPROVAL_REPLY_RE, (ctx) =>
      handleApprovalReply(ctx, { allowedUsers, approvals: this.approvals })
    );

    bot.on('message:text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) return;

      const userId = ctx.from.id;
      const username = ctx.from.username || ctx.from.first_name || 'unknown';

      if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
        if (dmPolicy === 'pairing') {
          this._cleanExpiredPairings();

          const existingCode = [...this.pendingPairings.entries()]
            .find(([_, d]) => d.userId === userId);
          if (existingCode) return;

          if (this.pendingPairings.size >= 3) return;

          const code = this._generatePairingCode();
          this.pendingPairings.set(code, { userId, username, chatId: ctx.chat.id, timestamp: Date.now() });

await ctx.reply(
            `QuantumClaw: access not configured.\n\n` +
            `Your Telegram user ID: ${userId}\n` +
            `Pairing code: ${code}\n\n` +
            `Ask the bot owner to approve with:\n` +
            `  qclaw pairing approve telegram ${code}`
          );
          log.warn(`Unpaired message from @${username} (${userId}) — pairing code sent: ${code}`);
        } else {
          log.warn(`Blocked Telegram message from unknown user: ${userId}`);
        }
        return;
      }
      
      let targetAgent = this.agents.primary();
      let messageText = ctx.message.text;
      
      const mentionMatch = messageText.match(/^@?(\w+):\s*(.*)$/s);
      if (mentionMatch) {
        const agentName = mentionMatch[1].toLowerCase();
        const found = this.agents.get(agentName);
        if (found) {
          targetAgent = found;
          messageText = mentionMatch[2].trim();
        }
      }
      
      const agent = targetAgent;
      if (!agent) {
        await ctx.reply('Agent not ready. Try again in a moment.');
        return;
      }

      try {
        await ctx.replyWithChatAction('typing');

        // Slice 1: session bootstrap. Sequential before agent.process() so the
        // agent's _buildSystemPrompt receives a populated BootstrapResult.
        // Failure is non-fatal — agent.process falls back to legacy assembly.
        const wasCached = isBootstrapCached(ctx.from.id, agent.name);
        let bootstrapResult = null;
        try {
          bootstrapResult = await bootstrap({
            userId: ctx.from.id,
            agentName: agent.name,
            services: agent.services,
            config: this.rootConfig
          });
        } catch (bootstrapErr) {
          log.warn(`Bootstrap failed for ${agent.name}/${ctx.from.id}: ${bootstrapErr.message}`);
        }

        const result = await agent.process(messageText, {
          channel: 'telegram',
          userId: ctx.from.id,
          username: ctx.from.username,
          bootstrap: bootstrapResult
        });

        let content = result?.content || '(empty response)';

        // First-fire warning surface: prepend a one-line notice the first
        // message after a fresh bootstrap if any layer/probe failed. Reset
        // by /session, clearBootstrapCache, or natural TTL expiry.
        if (bootstrapResult) {
          const wKey = `${ctx.from.id}:${agent.name}`;
          if (!wasCached) this.bootstrapWarningShown.set(wKey, false);
          const failedProbes = bootstrapResult.probes.filter((p) => !p.ok).length;
          const totalIssues = bootstrapResult.warnings.length + failedProbes;
          if (totalIssues > 0 && !this.bootstrapWarningShown.get(wKey)) {
            const wCount = bootstrapResult.warnings.length;
            content =
              `⚠️ Bootstrap: ${wCount} warning${wCount === 1 ? '' : 's'}, ` +
              `${failedProbes} probe failure${failedProbes === 1 ? '' : 's'} ` +
              `— see /bootstrap-status\n\n` + content;
            this.bootstrapWarningShown.set(wKey, true);
          }
        }

        const maxLen = 4096;
        const chunks = content.length <= maxLen
          ? [content]
          : this._chunkMessage(content, maxLen);

        for (const chunk of chunks) {
          await this._sendTelegramReply(ctx, chunk);
        }

        log.agent(agent.name, `[telegram] ${result.tier} → ${result.model || 'reflex'} (${result.cost ? '£' + result.cost.toFixed(4) : 'free'})`);

      } catch (err) {
        log.error(`Telegram handler error: ${err.stack || err.message}`);
        try {
          if (err.message?.includes('No AI provider') || err.message?.includes('No API key')) {
            await ctx.reply('⚠️ AI provider not configured. Run: qclaw onboard');
          } else if (err.message?.includes('rate') || err.message?.includes('429')) {
            await ctx.reply('Rate limited — try again in a moment.');
          } else {
            await ctx.reply('Something went wrong. Check the logs.');
          }
        } catch {}
      }
    });

    bot.on('message:voice', async (ctx) => {
      await ctx.reply('Voice messages coming soon. Send text for now.');
    });
  }

  /**
   * Slice 3e: invoked when the runner's task() promise rejects (e.g. 401 from
   * Telegram, 429 with maxRetryTime exceeded, or any other error the runner's
   * internal retry loop couldn't handle).
   *
   * Classifies the error, applies bounded inline retry on transient errors,
   * and degrades the channel (with recovery timer) on exhaust or non-transient
   * classification. The process never crashes from this path.
   */
  async _onRunnerFailure(err) {
    if (this.status === 'stopped') return;
    if (this._inFlightRecovery) {
      // Slice 3e fixup (finding 1): capture the failure so the current holder
      // can drain it once the lock releases. Previously this branch silently
      // dropped the failure — a new runner whose task rejected in the
      // microtask window between reinit success and lock release would leave
      // the channel reported `active` but in fact dead.
      this._pendingFailure = err;
      this._hasPendingFailure = true;
      return;
    }
    this._inFlightRecovery = true;
    try {
      let cls;
      try {
        cls = classifyGrammyError(err, { attempt: this._retryAttempts + 1 });
      } catch (classifyErr) {
        // Classifier itself threw — degrade to safe-default unknown-transient.
        cls = {
          kind: 'unknown',
          shouldRetry: this._retryAttempts < MAX_RETRY_ATTEMPTS,
          backoffMs: 1000,
          reason: 'classifier_threw',
        };
        try { log.warn(`[TelegramChannel] classifier threw: ${classifyErr.message}`); } catch {}
      }

      const eventKind = cls.kind === 'transient' ? 'transient_error'
        : cls.kind === 'non_transient' ? 'non_transient_error'
        : 'unknown_error';

      const errName = _safeErrProp(err, 'name', (err === null ? 'null' : typeof err));
      const errMsg = _safeErrProp(err, 'message', undefined, true);
      const errDescription = _safeErrProp(err, 'description', undefined, true);

      _appendChannelEvent({
        channel: 'telegram',
        event: eventKind,
        kind: cls.kind,
        // Slice 3e fixup-2 (finding 5): classifier's `reason` field
        // (e.g. 'classifier_threw', 'rate_limit', 'network_error',
        // 'unstructured_error', etc.) is the only way to distinguish the
        // classifier-safe-default path from a real unstructured error.
        // Surfaced here for observability and so the regression test for
        // Section 10 can assert against the actual code path.
        reason: cls.reason,
        http_status: cls.httpStatus,
        network_code: cls.networkCode,
        error_name: errName,
        error_message: errMsg || errDescription,
        retry_attempt: this._retryAttempts + 1,
        max_attempts: MAX_RETRY_ATTEMPTS,
        decision: cls.shouldRetry ? 'retry' : (cls.kind === 'non_transient' ? 'non_transient_fail' : 'degrade'),
      });

      if (cls.shouldRetry && this._retryAttempts < MAX_RETRY_ATTEMPTS) {
        this._retryAttempts += 1;
        this.status = 'retrying';
        const backoffMs = cls.backoffMs ?? 1000;
        _appendChannelEvent({
          channel: 'telegram',
          event: 'retry_scheduled',
          retry_attempt: this._retryAttempts,
          max_attempts: MAX_RETRY_ATTEMPTS,
          backoff_ms: backoffMs,
        });
        await this._sleep(backoffMs, '_backoffTimer');
        if (this.status === 'stopped') return;
        // Slice 3e fixup-3 (finding 1 + P0-B): capture the attempt number
        // BEFORE awaiting reinit. _reinitBot resets _retryAttempts to 0 on
        // success, so reading this._retryAttempts after the await would log
        // 0 instead of the attempt that actually succeeded. Pre-fixup-3 the
        // retry_succeeded.retry_attempt field has been 0 since Slice 3e
        // Unit 1 — pre-existing observability bug surfaced by P0-B in the
        // second cold-read; paired here with finding 1 (same shape, same
        // fix).
        const retryAttemptNum = this._retryAttempts;
        try {
          await this._reinitBot();
          // _reinitBot resets _retryAttempts on success.
          _appendChannelEvent({
            channel: 'telegram',
            event: 'retry_succeeded',
            retry_attempt: retryAttemptNum,
          });
        } catch (reinitErr) {
          // Recursive call — _inFlightRecovery is still true, so the recursion
          // is gated by the early-return at the top. We release the lock here
          // and re-enter cleanly. The drain step also runs from the outer
          // finally on the recursive call's frame, so a concurrent failure
          // arriving here will still be picked up.
          this._inFlightRecovery = false;
          await this._onRunnerFailure(reinitErr);
          return; // skip the outer finally lock-release (already released)
        }
      } else {
        // Exhausted retries OR non-transient. Degrade and start recovery timer.
        this._degrade(cls);
      }
    } finally {
      this._inFlightRecovery = false;
      this._drainPendingFailure();
    }
  }

  /**
   * Slice 3e fixup (finding 1): drain a failure captured while the recovery
   * lock was held. Called from the finally blocks of _onRunnerFailure and
   * _attemptRecovery. Re-enters via queueMicrotask to avoid growing the
   * suspended async stack and to keep the drain off the current call's
   * critical path.
   */
  _drainPendingFailure() {
    if (!this._hasPendingFailure) return;
    const pending = this._pendingFailure;
    this._pendingFailure = null;
    this._hasPendingFailure = false;
    if (this.status === 'stopped') return;
    queueMicrotask(() => {
      // Re-check status at fire-time — stop() may have run between the
      // microtask scheduling and now.
      if (this.status === 'stopped') return;
      this._onRunnerFailure(pending).catch((e) => {
        try { log.warn(`[TelegramChannel] pending-failure drain error: ${e.message}`); } catch {}
      });
    });
  }

  /**
   * Slice 3e: transition to degraded, schedule the first recovery tick.
   */
  _degrade(cls) {
    if (this.status === 'stopped') return;
    this.status = 'degraded';
    _appendChannelEvent({
      channel: 'telegram',
      event: 'degraded',
      kind: cls?.kind,
      http_status: cls?.httpStatus,
      network_code: cls?.networkCode,
      decision: 'degrade',
      recovery_attempt: this._recoveryAttempts,
      max_recovery_attempts: MAX_RECOVERY_ATTEMPTS,
    });
    this._scheduleRecovery();
  }

  /**
   * Slice 3e: schedule the next recovery tick. Idempotent — clears any existing
   * timer before re-scheduling. Stops scheduling once MAX_RECOVERY_ATTEMPTS is
   * reached.
   */
  _scheduleRecovery() {
    if (this.status === 'stopped') return;
    if (this._recoveryTimer) {
      try { clearTimeout(this._recoveryTimer); } catch {}
      this._recoveryTimer = null;
    }
    if (this._recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      _appendChannelEvent({
        channel: 'telegram',
        event: 'manual_intervention_required',
        recovery_attempt: this._recoveryAttempts,
        max_recovery_attempts: MAX_RECOVERY_ATTEMPTS,
      });
      return;
    }
    // Slice 3e fixup-2 (finding 10): apply ±25% jitter to the recovery
    // tick so multiple instances (HA active-active, or accidental
    // dual-PM2-restart overlap) don't lockstep their recovery polls and
    // double-hammer Telegram. Uses the same applyJitter helper as the
    // classifier's retry backoff, keeping the formula in one place
    // (base * 0.25 * (2*random - 1) = ±25%).
    const jitteredMs = _classifierInternal.applyJitter(RECOVERY_TICK_MS);
    this._recoveryTimer = setTimeout(() => {
      this._recoveryTimer = null;
      this._attemptRecovery().catch((err) => {
        try { log.warn(`[TelegramChannel] recovery tick error: ${err.message}`); } catch {}
      });
    }, jitteredMs);
    // Allow process to exit if this is the only handle left (tests).
    if (this._recoveryTimer && typeof this._recoveryTimer.unref === 'function') {
      this._recoveryTimer.unref();
    }
  }

  /**
   * Slice 3e: invoked by the recovery timer. Attempts re-init; on success,
   * resets counters and returns to active. On failure, increments
   * _recoveryAttempts and re-schedules the next tick.
   */
  async _attemptRecovery() {
    if (this.status === 'stopped') return;
    if (this._inFlightRecovery) {
      // A retry is already in progress; let it finish.
      this._scheduleRecovery();
      return;
    }
    this._inFlightRecovery = true;
    this._recoveryAttempts += 1;
    // Slice 3e fixup-3 (finding 1): capture the attempt number BEFORE
    // _reinitBot can reset it. Used by both recovery_attempt (current),
    // recovery_succeeded (post-reinit, when this._recoveryAttempts is 0
    // because _reinitBot resets it per fixup-2 #12), and recovery_failed
    // (pre-reset, but use the local for consistency).
    const recoveryAttemptNum = this._recoveryAttempts;
    _appendChannelEvent({
      channel: 'telegram',
      event: 'recovery_attempt',
      recovery_attempt: recoveryAttemptNum,
      max_recovery_attempts: MAX_RECOVERY_ATTEMPTS,
    });
    try {
      await this._reinitBot();
      _appendChannelEvent({
        channel: 'telegram',
        event: 'recovery_succeeded',
        recovery_attempt: recoveryAttemptNum,
      });
      this._recoveryAttempts = 0;
    } catch (err) {
      const cls = (() => { try { return classifyGrammyError(err); } catch { return { kind: 'unknown' }; } })();
      const errName = _safeErrProp(err, 'name', (err === null ? 'null' : typeof err));
      const errMsg = _safeErrProp(err, 'message', undefined, true);
      _appendChannelEvent({
        channel: 'telegram',
        event: 'recovery_failed',
        kind: cls.kind,
        // Slice 3e fixup-2 (finding 5): see parallel comment in
        // _onRunnerFailure for why `reason` is surfaced.
        reason: cls.reason,
        http_status: cls.httpStatus,
        network_code: cls.networkCode,
        error_name: errName,
        error_message: errMsg,
        recovery_attempt: recoveryAttemptNum,
        max_recovery_attempts: MAX_RECOVERY_ATTEMPTS,
      });
      this.status = 'degraded';
      this._scheduleRecovery();
    } finally {
      this._inFlightRecovery = false;
      this._drainPendingFailure();
    }
  }

  /**
   * Slice 3e: tear down the previous bot/runner, construct a fresh Bot,
   * register handlers, validate via getMe, deleteWebhook, and start the runner
   * with a new task.catch wiring. On success, sets status to active and resets
   * _retryAttempts.
   */
  async _reinitBot() {
    // Tear down the previous runner. The old task promise has already rejected;
    // calling stop() releases sockets and aborts pending fetches.
    if (this._runner) {
      try { await this._runner.stop(); } catch {}
    }
    this._runner = null;
    this.bot = null;

    const token = (await this.secrets.get('telegram_bot_token'))?.trim()
      || this.channelConfig.token
      || '';
    if (!token) throw new Error('No Telegram bot token available for re-init');

    const allowedUsers = this.channelConfig.allowedUsers || [];
    const dmPolicy = this.channelConfig.dmPolicy || 'pairing';

    const bot = await this._constructBot(token);
    this._registerBotHandlers(bot, allowedUsers, dmPolicy);

    // Validate the token. A 401 here is a real auth problem — surface it.
    await this._validateBot(bot);
    try { await bot.api.deleteWebhook({ drop_pending_updates: true }); } catch {}

    this.bot = bot;
    this._runner = this._runBot(bot);
    this._wireRunnerTaskCatch();
    this.status = 'active';
    this._retryAttempts = 0;
    // Slice 3e fixup-2 (finding 12): also reset the recovery budget on
    // a successful reinit. _attemptRecovery already resets this on the
    // recovery-timer success path; doing it here covers the inline-retry
    // success path too, so a degrade-recover-stable-then-degrade-again
    // sequence starts the new degradation episode with the full
    // 12-attempt recovery budget rather than {12 - prior_attempts}.
    this._recoveryAttempts = 0;
  }

  /**
   * Slice 3e fixup (finding 4): test seams. Extracted from _reinitBot so
   * integration tests can override these three methods on the instance to
   * exercise the full reinit path (including _wireRunnerTaskCatch on the
   * resulting runner handle) without touching the real grammy / Telegram
   * API. Defaults are unchanged production behaviour.
   */
  async _constructBot(token) {
    const { Bot } = await import('grammy');
    return new Bot(token);
  }

  async _validateBot(bot) {
    await bot.api.getMe();
  }

  _runBot(bot) {
    return run(bot, this._runBotOptions());
  }

  _runBotOptions() {
    return {
      runner: {
        fetch: { allowed_updates: ['message', 'callback_query'] },
        // Slice 3e fixup (finding 5): silent=true suppresses the grammY
        // runner's own console.error of fetch-update errors. The runner's
        // default logger writes a stringified error object that, for
        // HttpError, contains the full request URL — i.e. the bot token in
        // the path (2026-05-14 incident class). Slice 3e catches more
        // errors than the pre-slice baseline (the process no longer
        // restarts on them), so without this the leak volume to PM2 logs
        // would INCREASE post-merge in direct proportion to slice
        // success. channel-events.log records the same events scrubbed.
        silent: true,
      },
    };
  }

  /**
   * Slice 3e: sleep helper that stores the timer reference on the channel so
   * stop() can clear it. Resolves early on stop().
   *
   * Slice 3e fixup (finding 3): the original implementation only resolved
   * inside the setTimeout callback; clearTimeout in stop() cancelled the
   * callback but never settled the promise, leaving the awaiting
   * _onRunnerFailure suspended forever (with _inFlightRecovery permanently
   * held). The resolver is now captured into a sibling instance field that
   * stop() invokes after clearing the timer.
   */
  _sleep(ms, timerField) {
    const resolverField = timerField + 'Resolve';
    return new Promise((resolve) => {
      if (this.status === 'stopped') {
        // Already torn down before we got here — settle immediately.
        resolve();
        return;
      }
      const settle = () => {
        if (this[timerField] === t) this[timerField] = null;
        if (this[resolverField] === settle) this[resolverField] = null;
        resolve();
      };
      const t = setTimeout(settle, ms);
      this[timerField] = t;
      this[resolverField] = settle;
      if (t && typeof t.unref === 'function') t.unref();
    });
  }

  _chunkMessage(text, maxLen) {
    if (text.length <= maxLen) return [text];

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      let splitAt = remaining.lastIndexOf('\n\n', maxLen);
      if (splitAt > maxLen * 0.3) {
        chunks.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt + 2).trimStart();
        continue;
      }

      splitAt = remaining.lastIndexOf('\n', maxLen);
      if (splitAt > maxLen * 0.3) {
        chunks.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt + 1).trimStart();
        continue;
      }

      splitAt = remaining.lastIndexOf(' ', maxLen);
      if (splitAt > maxLen * 0.3) {
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt + 1);
        continue;
      }

      chunks.push(remaining.slice(0, maxLen));
      remaining = remaining.slice(maxLen);
    }

    return chunks;
  }

  async _sendTelegramReply(ctx, text) {
    try {
      await ctx.reply(text);
    } catch (err) {
      if (err.message?.includes('message is too long')) {
        const chunks = this._chunkMessage(text, 4000);
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      } else {
        throw err;
      }
    }
  }

  async send(recipient, content) {
    if (!this.bot) throw new Error('Telegram bot not started');
    const maxLen = 4096;
    const chunks = content.length <= maxLen
      ? [content]
      : this._chunkMessage(content, maxLen);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(recipient, chunk);
    }
  }

  async stop() {
    // Slice 3e: mark stopped FIRST so any in-flight recovery / retry callbacks
    // early-return rather than racing the teardown.
    this.status = 'stopped';
    // Slice 3e fixup (finding 1): drop any pending-drain failure — drainers
    // re-check status at fire-time but clearing here avoids holding onto the
    // error object after the channel is dead.
    this._pendingFailure = null;
    this._hasPendingFailure = false;
    if (this._backoffTimer) {
      try { clearTimeout(this._backoffTimer); } catch {}
      this._backoffTimer = null;
    }
    // Slice 3e fixup (finding 3): clearTimeout cancels the callback but
    // does NOT settle the promise — invoke the captured resolver so any
    // awaiting _onRunnerFailure resumes immediately and observes
    // status==='stopped' on its post-sleep check.
    if (this._backoffTimerResolve) {
      try { this._backoffTimerResolve(); } catch {}
      this._backoffTimerResolve = null;
    }
    if (this._recoveryTimer) {
      try { clearTimeout(this._recoveryTimer); } catch {}
      this._recoveryTimer = null;
    }
    if (this._runner) {
      try {
        await this._runner.stop();
      } catch (err) {
        log.debug(`Runner stop error: ${err.message}`);
      }
      this._runner = null;
    }
    _appendChannelEvent({ channel: 'telegram', event: 'stopped' });
  }
}