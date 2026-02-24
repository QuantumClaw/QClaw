/**
 * QuantumClaw Channel Manager
 *
 * Manages all input/output channels (Telegram, Discord, WhatsApp, etc.)
 * Each channel is a simple adapter: receive messages → agent → send response.
 */

import { log } from '../core/logger.js';

export class ChannelManager {
  constructor(config, agents, secrets) {
    this.config = config;
    this.agents = agents;
    this.secrets = secrets;
    this.channels = [];
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
          log.success(`Channel: ${name}`);
        }
      } catch (err) {
        log.warn(`Channel ${name} failed to start: ${err.message}`);
      }
    }
  }

  async stopAll() {
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
        return new TelegramChannel(config, this.agents, this.secrets, this.config);
      // Future channels:
      // case 'discord': return new DiscordChannel(config, this.agents, this.secrets, this.config);
      // case 'whatsapp': return new WhatsAppChannel(config, this.agents, this.secrets, this.config);
      // case 'slack': return new SlackChannel(config, this.agents, this.secrets, this.config);
      default:
        log.debug(`Channel "${name}" not yet implemented`);
        return null;
    }
  }
}

/**
 * Telegram Channel using grammY
 *
 * DM policy: "pairing" (default, like OpenClaw)
 * 1. Unknown user sends any message → bot replies with 8-char pairing code
 * 2. User enters code in dashboard or CLI: qclaw pairing approve telegram <CODE>
 * 3. User ID saved to allowedUsers, messages start processing
 *
 * Pairing codes: 8 chars, uppercase, no ambiguous chars (0O1I)
 * Expire after 1 hour. Max 3 pending per channel.
 */
class TelegramChannel {
  constructor(channelConfig, agents, secrets, rootConfig) {
    this.channelConfig = channelConfig;
    this.channelConfig.channelName = 'telegram'; // for dashboard lookup
    this.rootConfig = rootConfig;
    this.agents = agents;
    this.secrets = secrets;
    this.bot = null;
    this.pendingPairings = new Map(); // code → { userId, username, timestamp }
  }

  _generatePairingCode() {
    // 8 chars, uppercase, no ambiguous chars (0O1I)
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

  /**
   * Approve a pairing code. Called from CLI or dashboard.
   * Returns the user info if successful, null if code not found/expired.
   */
  async approvePairing(code) {
    this._cleanExpiredPairings();
    const data = this.pendingPairings.get(code.toUpperCase());
    if (!data) return null;

    const allowedUsers = this.channelConfig.allowedUsers || [];
    if (!allowedUsers.includes(data.userId)) {
      allowedUsers.push(data.userId);
      this.channelConfig.allowedUsers = allowedUsers;

      // Save to root config
      try {
        const { saveConfig } = await import('../core/config.js');
        if (this.rootConfig.channels?.telegram) {
          this.rootConfig.channels.telegram.allowedUsers = allowedUsers;
          saveConfig(this.rootConfig);
        }
      } catch {
        // Config save failed — user is still in memory for this session
      }
    }

    this.pendingPairings.delete(code.toUpperCase());
    return data;
  }

  async start() {
    const { Bot } = await import('grammy');

    // Get token from encrypted store (never cleartext config)
    const token = (await this.secrets.get('telegram_bot_token'))?.trim()
      || this.channelConfig.token  // legacy fallback
      || '';
    if (!token) throw new Error('No Telegram bot token. Re-run: qclaw onboard');

    this.bot = new Bot(token);
    const allowedUsers = this.channelConfig.allowedUsers || [];
    const dmPolicy = this.channelConfig.dmPolicy || 'pairing';

    // Handle /start command
    this.bot.command('start', async (ctx) => {
      const userId = ctx.from.id;
      const username = ctx.from.username || ctx.from.first_name || 'unknown';

      if (allowedUsers.includes(userId)) {
        await ctx.reply(`Already paired. Send me a message and I'll get to work.`);
        return;
      }

      if (dmPolicy === 'pairing') {
        // Generate pairing code
        this._cleanExpiredPairings();
        if (this.pendingPairings.size >= 3) {
          await ctx.reply(`Too many pending pairing requests. Try again later.`);
          return;
        }

        const code = this._generatePairingCode();
        this.pendingPairings.set(code, { userId, username, chatId: ctx.chat.id, timestamp: Date.now() });

        await ctx.reply(
          `🔐 *QuantumClaw Pairing*\n\n` +
          `Your Telegram user ID: \`${userId}\`\n` +
          `Username: @${username}\n\n` +
          `Pairing code:`,
          { parse_mode: 'Markdown' }
        );
        // Send code as separate message (easy to copy on mobile, like OpenClaw)
        await ctx.reply(code);
        await ctx.reply(
          `Approve with:\n\`qclaw pairing approve telegram ${code}\`\n\n` +
          `Or enter the code in your dashboard.\n` +
          `Code expires in 1 hour.`,
          { parse_mode: 'Markdown' }
        );

        log.info(`Telegram pairing request from @${username} (${userId}) — code: ${code}`);
      } else {
        await ctx.reply(
          `QuantumClaw: access not configured.\n\n` +
          `Your Telegram user ID: ${userId}\n\n` +
          `Ask the bot owner to add you with:\n` +
          `  qclaw config set channels.telegram.allowedUsers ${userId}`
        );
        log.warn(`Unpaired user tried /start: @${username} (${userId})`);
      }
    });

    // Handle regular messages
    this.bot.on('message:text', async (ctx) => {
      // Ignore /start (handled above)
      if (ctx.message.text.startsWith('/')) return;

      const userId = ctx.from.id;
      const username = ctx.from.username || ctx.from.first_name || 'unknown';

      // Check if user is allowed
      if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
        if (dmPolicy === 'pairing') {
          // Unknown user — send pairing code (same as /start)
          this._cleanExpiredPairings();

          // Don't spam codes — check if one was sent recently for this user
          const existingCode = [...this.pendingPairings.entries()]
            .find(([_, d]) => d.userId === userId);
          if (existingCode) {
            // Already has a pending code, don't send another
            return;
          }

          if (this.pendingPairings.size >= 3) return; // silently ignore

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

       // Parse agent mention from message (support @agentname or agentname:)
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

        // Guard against empty/undefined content
        let content = result?.content || '(empty response)';

        // INTERCEPT: If agent output contains /skill command, execute it
        if (content.includes('/skill ')) {
          try {
            await ctx.replyWithChatAction('typing');
            
            // Extract just the /skill command line
            const skillLine = content.match(/\/skill\s+.+$/m)?.[0];
            if (skillLine) {
              // Re-process as a direct command through the agent
              const skillResult = await agent.process(skillLine, {
                channel: 'telegram',
                userId: ctx.from.id,
                username: ctx.from.username
              });
              
              content = skillResult?.content || '(skill execution failed)';
              log.agent(agent.name, `[auto-skill] executed`);
            }
          } catch (err) {
            content = `Skill execution failed: ${err.message}`;
            log.error(`Auto-skill error: ${err.message}`);
          }
        }

        // Broadcast to dashboard so messages appear in real-time
        if (this._broadcast) {
          this._broadcast({
            type: 'channel_message',
            channel: 'telegram',
            username: username || String(userId),
            userMessage: ctx.message.text,
            response: content,
            agent: agent.name,
            tier: result.tier,
            model: result.model,
            cost: result.cost
          });
        }

        // Send response (split if too long for Telegram)
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
          // Give user-friendly error based on type
          if (err.message?.includes('No AI provider') || err.message?.includes('No API key')) {
            await ctx.reply('⚠️ AI provider not configured. Run: qclaw onboard');
          } else if (err.message?.includes('rate') || err.message?.includes('429')) {
            await ctx.reply('Rate limited — try again in a moment.');
          } else {
            await ctx.reply('Something went wrong. Check the logs.');
          }
        } catch {
          // Can't even send error message — network issue
        }
      }
    });

    // Handle voice messages (future: transcription)
    this.bot.on('message:voice', async (ctx) => {
      await ctx.reply('Voice messages coming soon. Send text for now.');
    });

    // Verify token with getMe before starting polling
    try {
      const me = await this.bot.api.getMe();
      log.info(`Telegram bot: @${me.username} (${me.id})`);
    } catch (err) {
      throw new Error(`Telegram token invalid: ${err.message}`);
    }

    // Delete any existing webhook before starting polling
    try {
      await this.bot.api.deleteWebhook({ drop_pending_updates: true });
    } catch {
      // No webhook set — fine
    }

    // Start polling
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

  /**
   * Split a long message into chunks on paragraph boundaries.
   * Falls back to sentence boundaries, then hard-splits as last resort.
   */
  _chunkMessage(text, maxLen) {
    if (text.length <= maxLen) return [text];

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      // Try to split on double newline (paragraph boundary)
      let splitAt = remaining.lastIndexOf('\n\n', maxLen);
      if (splitAt > maxLen * 0.3) {
        chunks.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt + 2).trimStart();
        continue;
      }

      // Try single newline
      splitAt = remaining.lastIndexOf('\n', maxLen);
      if (splitAt > maxLen * 0.3) {
        chunks.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt + 1).trimStart();
        continue;
      }

      // Try space (word boundary)
      splitAt = remaining.lastIndexOf(' ', maxLen);
      if (splitAt > maxLen * 0.3) {
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt + 1);
        continue;
      }

      // Last resort: hard split
      chunks.push(remaining.slice(0, maxLen));
      remaining = remaining.slice(maxLen);
    }

    return chunks;
  }

  async stop() {
    if (this.bot) {
      await this.bot.stop();
    }
  }

  /**
   * Send a reply with Markdown, falling back to plain text if Telegram rejects it.
   * Telegram's Markdown parser is strict — unmatched *, _, `, [ etc. cause 400 errors.
   */
  async _sendTelegramReply(ctx, text) {
    try {
      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (mdErr) {
      // Markdown parse failed — try plain text
      try {
        await ctx.reply(text);
      } catch (plainErr) {
        // Plain text also failed — try escaping problematic chars and send plain
        log.debug(`Telegram reply failed even as plain text: ${plainErr.message}`);
        try {
          // Last resort: strip all markdown-like chars
          const safe = text.replace(/[*_`\[\]()~>#+\-=|{}.!]/g, '');
          await ctx.reply(safe || '(response contained only special characters)');
        } catch {
          log.error('Telegram: all reply attempts failed');
        }
      }
    }
  }
}
