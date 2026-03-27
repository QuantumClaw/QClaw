/**
 * QuantumClaw Channel Manager
 *
 * Manages all input/output channels (Telegram, Discord, WhatsApp, etc.)
 * Each channel is a simple adapter: receive messages → agent → send response.
 */

import { log } from '../core/logger.js';

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
    this.pendingPairings = new Map();
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

    this.bot.command('start', async (ctx) => {
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

    this.bot.command('pending', async (ctx) => {
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

    this.bot.command('approve', async (ctx) => {
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

    this.bot.on('message:text', async (ctx) => {
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

        const result = await agent.process(messageText, {
          channel: 'telegram',
          userId: ctx.from.id,
          username: ctx.from.username
        });

        const content = result?.content || '(empty response)';

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

    this.bot.on('message:voice', async (ctx) => {
      await ctx.reply('Voice messages coming soon. Send text for now.');
    });

    try {
      const me = await this.bot.api.getMe();
      log.info(`Telegram bot: @${me.username} (${me.id})`);
    } catch (err) {
      throw new Error(`Telegram token invalid: ${err.message}`);
    }

    try {
      await this.bot.api.deleteWebhook({ drop_pending_updates: true });
    } catch {}

    this.bot.start({
      drop_pending_updates: true,
      onStart: () => {
        if (allowedUsers.length === 0) {
          log.info('Telegram: send /start to your bot to begin pairing');
        } else {
          log.success(`Telegram: ready (${allowedUsers.length} user${allowedUsers.length === 1 ? '' : 's'})`);
        }
      }
    }).catch(err => {
      log.error(`Telegram polling error: ${err.message}`);
      this.bot = null;
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
    if (this.bot) {
      await this.bot.stop();
    }
  }
}