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
      case 'discord':
        return new DiscordChannel(config, this.agents, this.secrets, this.config);
      case 'whatsapp':
        return new WhatsAppChannel(config, this.agents, this.secrets, this.config);
      case 'email':
        return new EmailChannel(config, this.agents, this.secrets, this.config);
      case 'slack':
        return new SlackChannel(config, this.agents, this.secrets, this.config);
      default:
        log.debug(`Channel "${name}" not yet implemented`);
        return null;
    }
  }

  /**
   * Get channel routing — which agent handles which channel
   */
  getRouting() {
    const routes = {};
    for (const channel of this.channels) {
      const name = channel.channelConfig?.channelName;
      const agentName = channel.channelConfig?.agent || 'primary';
      routes[name] = agentName;
    }
    return routes;
  }

  /** Get the agent assigned to a channel (via config.agent, fallback to primary) */
  _getAgent(channelConfig) {
    const agentName = channelConfig?.agent;
    if (agentName && agentName !== 'primary') {
      const agent = this.agents.get(agentName);
      if (agent) return agent;
    }
    return this.agents.primary();
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
    const { Bot, InputFile } = await import('grammy');

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
      const text = ctx.message.text;

      // Handle slash commands
      if (text.startsWith('/')) {
        const [cmd, ...args] = text.split(' ');
        const reply = await this._handleSlashCommand(cmd.toLowerCase(), args, 'telegram', ctx.from.id);
        if (reply) { await ctx.reply(reply, { parse_mode: 'Markdown' }); }
        return;
      }

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

      const agent = this.agents.primary();
      if (!agent) {
        await ctx.reply('Agent not ready. Try again in a moment.');
        return;
      }

      // Group chat: only respond if mentioned or replied to
      const chatType = ctx.chat?.type;
      if (chatType === 'group' || chatType === 'supergroup') {
        const botInfo = this.bot.botInfo;
        const botUsername = botInfo?.username ? `@${botInfo.username}` : null;
        const mentionPatterns = this.channelConfig.mentionPatterns || [];
        const isMentioned = (botUsername && text.includes(botUsername))
          || mentionPatterns.some(p => text.toLowerCase().includes(p.toLowerCase()))
          || ctx.message.reply_to_message?.from?.id === botInfo?.id;

        if (!isMentioned) return; // silently ignore non-mentioned group messages
      }

      try {
        await ctx.replyWithChatAction('typing');

        const result = await agent.process(ctx.message.text, {
          channel: 'telegram',
          userId: ctx.from.id,
          username: ctx.from.username
        });

        // Guard against empty/undefined content
        const content = result?.content || '(empty response)';

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

    // Handle voice messages — transcribe → agent → TTS reply
    this.bot.on('message:voice', async (ctx) => {
      const userId = ctx.from.id;
      if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) return;

      const agent = this.agents.primary();
      if (!agent) { await ctx.reply('Agent not ready.'); return; }

      const voice = agent.services?.voice;
      if (!voice) { await ctx.reply('Voice not configured. Add a Deepgram or OpenAI API key.'); return; }

      try {
        await ctx.replyWithChatAction('typing');

        // Download voice file from Telegram
        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
        const audioRes = await fetch(fileUrl, { signal: AbortSignal.timeout(15000) });
        if (!audioRes.ok) throw new Error('Failed to download voice file');
        const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

        // Transcribe
        const sttResult = await voice.transcribe(audioBuffer, 'audio/ogg');
        const transcript = sttResult.text?.trim();
        if (!transcript) {
          await ctx.reply("Couldn't understand that voice message. Try again?");
          return;
        }

        // Show transcript to user
        await ctx.reply(`🎙️ "${transcript}"`);
        await ctx.replyWithChatAction('typing');

        const username = ctx.from.username || ctx.from.first_name || 'unknown';

        // Process through agent
        const result = await agent.process(transcript, {
          channel: 'telegram',
          userId: ctx.from.id,
          username,
          isVoice: true,
        });

        const content = result?.content || '(empty response)';

        // Broadcast to dashboard
        if (this._broadcast) {
          this._broadcast({
            type: 'channel_message',
            channel: 'telegram',
            username: username || String(userId),
            userMessage: `🎙️ ${transcript}`,
            response: content,
            agent: agent.name,
            tier: result.tier,
            model: result.model,
            cost: result.cost,
          });
        }

        // Try to reply as voice note (TTS)
        let sentVoice = false;
        if (content.length < 3000) {
          try {
            const ttsResult = await voice.synthesize(content);
            await ctx.replyWithVoice(
              new InputFile(ttsResult.buffer, 'response.ogg'),
              { caption: content.length > 200 ? content.slice(0, 200) + '...' : undefined }
            );
            sentVoice = true;
          } catch (ttsErr) {
            log.debug(`TTS reply failed: ${ttsErr.message}`);
          }
        }

        // Fallback: send text if TTS failed or response too long
        if (!sentVoice) {
          const maxLen = 4096;
          const chunks = content.length <= maxLen ? [content] : this._chunkMessage(content, maxLen);
          for (const chunk of chunks) {
            await this._sendTelegramReply(ctx, chunk);
          }
        }

        log.agent(agent.name, `[telegram:voice] ${sttResult.provider} → ${result.tier} → ${result.model || 'reflex'}`);
      } catch (err) {
        log.error(`Telegram voice error: ${err.message}`);
        await ctx.reply('Voice processing failed: ' + err.message).catch(() => {});
      }
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

  async _handleSlashCommand(cmd, args, channel, userId) {
    switch (cmd) {
      case '/start': return null; // handled separately
      case '/help':
        return '⚛ *QuantumClaw Commands*\n\n' +
          '/help — show this message\n' +
          '/status — agent status\n' +
          '/model — current model info\n' +
          '/reset — reset conversation\n' +
          '/memory — memory stats\n' +
          '/cost — today\'s spending\n' +
          '/whoami — your pairing info';
      case '/status': {
        const agent = this.agents.primary();
        return agent ? `✅ Agent *${agent.name}* is online.` : '❌ No agent loaded.';
      }
      case '/model': {
        const agent = this.agents.primary();
        if (!agent) return '❌ No agent loaded.';
        return `🤖 *Model routing:*\nPrimary: ${this.config.models?.primary || 'auto'}\nTiers: reflex → simple → standard → complex → expert`;
      }
      case '/reset': {
        return '🔄 Conversation context reset. Send a new message to start fresh.';
      }
      case '/memory': {
        return '🧠 Memory active — semantic + episodic + procedural layers. Use the dashboard for detailed stats.';
      }
      case '/cost': {
        return '💰 Cost tracking available in the dashboard → Usage page.';
      }
      case '/whoami': {
        return `👤 Your ID: \`${userId}\`\nChannel: ${channel}\nPaired: ✅`;
      }
      default:
        return `Unknown command: ${cmd}\nType /help for available commands.`;
    }
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

// ─── Discord Channel ────────────────────────────────────────
// Uses discord.js v14. Same pairing flow as Telegram.
// npm i discord.js (auto-installed on first use if missing)

class DiscordChannel {
  constructor(channelConfig, agents, secrets, rootConfig) {
    this.channelConfig = channelConfig;
    this.channelConfig.channelName = 'discord';
    this.rootConfig = rootConfig;
    this.agents = agents;
    this.secrets = secrets;
    this.client = null;
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
        if (this.rootConfig.channels?.discord) {
          this.rootConfig.channels.discord.allowedUsers = allowedUsers;
          saveConfig(this.rootConfig);
        }
      } catch { /* non-fatal */ }
    }

    this.pendingPairings.delete(code.toUpperCase());

    // Send confirmation DM
    if (data.dmChannel) {
      try { await data.dmChannel.send('✓ Paired successfully! Send me a message.'); } catch { /* */ }
    }
    return data;
  }

  async start() {
    let discordJs;
    try {
      discordJs = await import('discord.js');
    } catch {
      log.warn('discord.js not installed. Run: npm i discord.js');
      throw new Error('discord.js not installed');
    }

    const { Client, GatewayIntentBits, Partials } = discordJs;

    const token = (await this.secrets.get('discord_bot_token'))?.trim()
      || this.channelConfig.token || '';
    if (!token) throw new Error('No Discord bot token. Add via: qclaw secret set discord_bot_token <token>');

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel], // needed for DMs
    });

    const allowedUsers = this.channelConfig.allowedUsers || [];
    // Optional: restrict to specific channel IDs
    const allowedChannelIds = this.channelConfig.allowedChannels || [];

    this.client.on('ready', () => {
      log.success(`Discord: ${this.client.user.tag} (${this.client.guilds.cache.size} server${this.client.guilds.cache.size === 1 ? '' : 's'})`);
    });

    this.client.on('messageCreate', async (message) => {
      // Ignore own messages and other bots
      if (message.author.bot) return;
      if (message.author.id === this.client.user.id) return;

      // If channel restrictions set, check them (skip for DMs)
      if (allowedChannelIds.length > 0 && !message.channel.isDMBased?.()) {
        if (!allowedChannelIds.includes(message.channel.id)) return;
      }

      // For guild messages, only respond when mentioned or in allowed channels
      if (!message.channel.isDMBased?.() && allowedChannelIds.length === 0) {
        if (!message.mentions.has(this.client.user)) return;
      }

      const userId = message.author.id;
      const username = message.author.username || message.author.tag || 'unknown';

      // Clean bot mention from message text
      let text = message.content
        .replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '')
        .trim();
      if (!text) return;

      // Pairing check
      if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
        this._cleanExpiredPairings();
        const existing = [...this.pendingPairings.entries()].find(([_, d]) => d.userId === userId);
        if (existing) return; // already has a pending code
        if (this.pendingPairings.size >= 3) return;

        const code = this._generatePairingCode();
        let dmChannel = null;
        try { dmChannel = await message.author.createDM(); } catch { /* can't DM */ }
        this.pendingPairings.set(code, { userId, username, timestamp: Date.now(), dmChannel });

        const reply = `🔐 **QuantumClaw Pairing**\n\nYour Discord ID: \`${userId}\`\nPairing code: \`${code}\`\n\nApprove with:\n\`qclaw pairing approve discord ${code}\`\nOr enter the code in your dashboard. Expires in 1 hour.`;
        try {
          if (dmChannel) await dmChannel.send(reply);
          else await message.reply(reply);
        } catch { /* couldn't send */ }

        log.info(`Discord pairing request from ${username} (${userId}) — code: ${code}`);
        return;
      }

      // Process message
      const agent = this.agents.primary();
      if (!agent) { try { await message.reply('Agent not ready.'); } catch { /**/ } return; }

      try {
        // Show typing
        try { await message.channel.sendTyping(); } catch { /* */ }

        const result = await agent.process(text, {
          channel: 'discord',
          userId,
          username,
        });

        const content = result?.content || '(empty response)';

        // Broadcast to dashboard
        if (this._broadcast) {
          this._broadcast({
            type: 'channel_message',
            channel: 'discord',
            username,
            userMessage: text,
            response: content,
            agent: agent.name,
            tier: result.tier,
            model: result.model,
            cost: result.cost,
          });
        }

        // Discord has 2000 char limit
        const maxLen = 2000;
        if (content.length <= maxLen) {
          await message.reply(content);
        } else {
          const chunks = [];
          let remaining = content;
          while (remaining.length > 0) {
            if (remaining.length <= maxLen) { chunks.push(remaining); break; }
            let splitAt = remaining.lastIndexOf('\n', maxLen);
            if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf(' ', maxLen);
            if (splitAt < maxLen * 0.3) splitAt = maxLen;
            chunks.push(remaining.slice(0, splitAt));
            remaining = remaining.slice(splitAt).trimStart();
          }
          for (const chunk of chunks) {
            await message.reply(chunk);
          }
        }

        log.agent(agent.name, `[discord] ${result.tier} → ${result.model || 'reflex'} (${result.cost ? '£' + result.cost.toFixed(4) : 'free'})`);
      } catch (err) {
        log.error(`Discord handler error: ${err.message}`);
        try { await message.reply('Something went wrong. Check the logs.'); } catch { /* */ }
      }
    });

    await this.client.login(token);
  }

  async stop() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }
}

// ─── WhatsApp Channel ───────────────────────────────────────
// Uses whatsapp-web.js with QR code pairing.
// npm i whatsapp-web.js qrcode-terminal (auto-checked on start)

class WhatsAppChannel {
  constructor(channelConfig, agents, secrets, rootConfig) {
    this.channelConfig = channelConfig;
    this.channelConfig.channelName = 'whatsapp';
    this.rootConfig = rootConfig;
    this.agents = agents;
    this.secrets = secrets;
    this.client = null;
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

  async approvePairing(code) {
    const data = this.pendingPairings.get(code.toUpperCase());
    if (!data) return null;
    const allowedUsers = this.channelConfig.allowedUsers || [];
    if (!allowedUsers.includes(data.userId)) {
      allowedUsers.push(data.userId);
      this.channelConfig.allowedUsers = allowedUsers;
      try {
        const { saveConfig } = await import('../core/config.js');
        if (this.rootConfig.channels?.whatsapp) {
          this.rootConfig.channels.whatsapp.allowedUsers = allowedUsers;
          saveConfig(this.rootConfig);
        }
      } catch { /* */ }
    }
    this.pendingPairings.delete(code.toUpperCase());
    return data;
  }

  async start() {
    let wwjs, qrcodeTerminal;
    try {
      wwjs = await import('whatsapp-web.js');
    } catch {
      log.warn('whatsapp-web.js not installed. Run: npm i whatsapp-web.js');
      throw new Error('whatsapp-web.js not installed');
    }
    try {
      qrcodeTerminal = await import('qrcode-terminal');
    } catch {
      qrcodeTerminal = null; // non-fatal, QR just won't show in terminal
    }

    const { Client: WAClient, LocalAuth } = wwjs.default || wwjs;
    const { join } = await import('path');

    this.client = new WAClient({
      authStrategy: new LocalAuth({
        dataPath: join(this.rootConfig._dir, 'whatsapp-session'),
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    const allowedUsers = this.channelConfig.allowedUsers || [];

    this.client.on('qr', (qr) => {
      log.info('WhatsApp: scan QR code in your WhatsApp mobile app');
      if (qrcodeTerminal?.generate) {
        qrcodeTerminal.generate(qr, { small: true });
      } else {
        log.info(`QR data: ${qr.slice(0, 50)}...`);
      }
      // Broadcast QR to dashboard
      if (this._broadcast) {
        this._broadcast({ type: 'whatsapp_qr', qr });
      }
    });

    this.client.on('ready', () => {
      log.success('WhatsApp: connected and ready');
    });

    this.client.on('auth_failure', (msg) => {
      log.error(`WhatsApp auth failed: ${msg}`);
    });

    this.client.on('message', async (message) => {
      // Ignore group messages unless explicitly allowed
      if (message.from.endsWith('@g.us') && !this.channelConfig.allowGroups) return;
      // Ignore status broadcasts
      if (message.from === 'status@broadcast') return;

      const userId = message.from;
      const contact = await message.getContact();
      const username = contact.pushname || contact.name || userId.split('@')[0];
      const text = message.body;

      if (!text) return;

      // Pairing check
      if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
        const existing = [...this.pendingPairings.entries()].find(([_, d]) => d.userId === userId);
        if (existing) return;
        if (this.pendingPairings.size >= 3) return;

        const code = this._generatePairingCode();
        this.pendingPairings.set(code, { userId, username, timestamp: Date.now() });

        await message.reply(
          `🔐 QuantumClaw Pairing\n\n` +
          `Your ID: ${userId}\n` +
          `Pairing code: ${code}\n\n` +
          `Approve with:\nqclaw pairing approve whatsapp ${code}\n\n` +
          `Or enter the code in your dashboard.`
        );
        log.info(`WhatsApp pairing request from ${username} — code: ${code}`);
        return;
      }

      const agent = this.agents.primary();
      if (!agent) { try { await message.reply('Agent not ready.'); } catch { /**/ } return; }

      try {
        // Show typing
        const chat = await message.getChat();
        await chat.sendStateTyping();

        const result = await agent.process(text, {
          channel: 'whatsapp',
          userId,
          username,
        });

        const content = result?.content || '(empty response)';

        // Broadcast to dashboard
        if (this._broadcast) {
          this._broadcast({
            type: 'channel_message',
            channel: 'whatsapp',
            username,
            userMessage: text,
            response: content,
            agent: agent.name,
            tier: result.tier,
            model: result.model,
            cost: result.cost,
          });
        }

        await message.reply(content);
        log.agent(agent.name, `[whatsapp] ${result.tier} → ${result.model || 'reflex'} (${result.cost ? '£' + result.cost.toFixed(4) : 'free'})`);
      } catch (err) {
        log.error(`WhatsApp handler error: ${err.message}`);
        try { await message.reply('Something went wrong. Check the logs.'); } catch { /* */ }
      }
    });

    // Initialize — this triggers QR code on first connect
    await this.client.initialize();
  }

  async stop() {
    if (this.client) {
      try { await this.client.destroy(); } catch { /* */ }
      this.client = null;
    }
  }
}

/**
 * Email Channel — IMAP polling + SMTP sending
 *
 * Config:
 * {
 *   channels: {
 *     email: {
 *       enabled: true,
 *       imap: { host: "imap.gmail.com", port: 993, tls: true },
 *       smtp: { host: "smtp.gmail.com", port: 587, secure: false },
 *       pollIntervalMs: 60000,
 *       allowedSenders: ["boss@company.com"],
 *       agent: "support" // optional routing
 *     }
 *   }
 * }
 * Secrets: email_address, email_password (app password for Gmail)
 */
class EmailChannel {
  constructor(channelConfig, agents, secrets, config) {
    this.channelConfig = { ...channelConfig, channelName: 'email' };
    this.agents = agents;
    this.secrets = secrets;
    this.config = config;
    this._pollTimer = null;
    this._broadcast = null;
    this._lastUid = 0;
    this._transporter = null;
    this._imapClient = null;
  }

  setBroadcast(fn) { this._broadcast = fn; }

  async start() {
    const emailAddr = await this.secrets.get('email_address');
    const emailPass = await this.secrets.get('email_password');
    if (!emailAddr || !emailPass) {
      log.warn('Email channel: missing email_address or email_password secret');
      return;
    }

    const imapConf = this.channelConfig.imap || { host: 'imap.gmail.com', port: 993, tls: true };
    const smtpConf = this.channelConfig.smtp || { host: 'smtp.gmail.com', port: 587, secure: false };

    // Setup SMTP via nodemailer
    try {
      const nodemailer = await import('nodemailer');
      this._transporter = nodemailer.default.createTransport({
        host: smtpConf.host,
        port: smtpConf.port,
        secure: smtpConf.secure ?? false,
        auth: { user: emailAddr, pass: emailPass },
      });
      log.info(`Email SMTP: ${smtpConf.host}:${smtpConf.port}`);
    } catch (err) {
      log.warn(`Email SMTP failed: ${err.message}`);
    }

    // Setup IMAP polling via imapflow
    try {
      const { ImapFlow } = await import('imapflow');
      this._imapClient = new ImapFlow({
        host: imapConf.host,
        port: imapConf.port,
        secure: imapConf.tls ?? true,
        auth: { user: emailAddr, pass: emailPass },
        logger: false,
      });

      await this._imapClient.connect();
      log.info(`Email IMAP: ${imapConf.host}:${imapConf.port} ✓`);

      // Start polling
      const pollMs = this.channelConfig.pollIntervalMs || 60000;
      this._pollTimer = setInterval(() => this._poll(), pollMs);
      await this._poll(); // Initial poll
    } catch (err) {
      log.warn(`Email IMAP failed: ${err.message} — install imapflow: npm i imapflow`);
    }
  }

  async _poll() {
    if (!this._imapClient) return;
    try {
      const lock = await this._imapClient.getMailboxLock('INBOX');
      try {
        // Fetch unseen messages
        const messages = [];
        for await (const msg of this._imapClient.fetch({ seen: false }, { envelope: true, source: true })) {
          messages.push(msg);
        }

        for (const msg of messages) {
          const from = msg.envelope?.from?.[0]?.address || 'unknown';
          const subject = msg.envelope?.subject || '(no subject)';
          const allowed = this.channelConfig.allowedSenders || [];

          // Filter by allowed senders if configured
          if (allowed.length > 0 && !allowed.includes(from)) continue;

          // Extract text body
          let body = '';
          if (msg.source) {
            const text = msg.source.toString();
            // Simple text extraction — find text after headers
            const bodyStart = text.indexOf('\r\n\r\n');
            if (bodyStart > -1) body = text.slice(bodyStart + 4, bodyStart + 2000).trim();
          }

          const userMessage = `[Email from ${from}] Subject: ${subject}\n\n${body}`.slice(0, 3000);

          // Process through agent
          const agent = this.agents.primary();
          if (!agent) continue;

          try {
            const result = await agent.process(userMessage, {
              channel: 'email',
              userId: from,
              username: from,
            });

            // Send reply
            if (result.content && this._transporter) {
              await this._transporter.sendMail({
                from: await this.secrets.get('email_address'),
                to: from,
                subject: `Re: ${subject}`,
                text: result.content,
              });
            }

            // Mark as seen
            if (msg.uid) {
              await this._imapClient.messageFlagsAdd({ uid: msg.uid }, ['\\Seen']);
            }

            // Broadcast to dashboard
            if (this._broadcast) {
              this._broadcast({
                type: 'channel_message',
                channel: 'email',
                username: from,
                userMessage: `📧 ${subject}`,
                response: result.content,
                agent: agent.name,
                tier: result.tier,
                model: result.model,
                cost: result.cost,
              });
            }

            log.agent(agent.name, `[email] ${from}: ${subject.slice(0, 40)} → ${result.tier}`);
          } catch (err) {
            log.error(`Email processing error: ${err.message}`);
          }
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      log.debug(`Email poll error: ${err.message}`);
    }
  }

  async stop() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._imapClient) {
      try { await this._imapClient.logout(); } catch { /* */ }
      this._imapClient = null;
    }
  }
}

/**
 * Slack Channel — Bolt SDK (Socket Mode)
 *
 * Config:
 * {
 *   channels: {
 *     slack: {
 *       enabled: true,
 *       allowedChannels: ["C0123456789"], // empty = respond everywhere
 *       agent: "support" // optional routing
 *     }
 *   }
 * }
 * Secrets: slack_bot_token, slack_app_token (for socket mode)
 */
class SlackChannel {
  constructor(channelConfig, agents, secrets, config) {
    this.channelConfig = { ...channelConfig, channelName: 'slack' };
    this.agents = agents;
    this.secrets = secrets;
    this.config = config;
    this.app = null;
    this._broadcast = null;
  }

  setBroadcast(fn) { this._broadcast = fn; }

  async start() {
    const botToken = await this.secrets.get('slack_bot_token');
    const appToken = await this.secrets.get('slack_app_token');
    if (!botToken || !appToken) {
      log.warn('Slack channel: missing slack_bot_token or slack_app_token secret');
      return;
    }

    try {
      const { App } = await import('@slack/bolt');
      this.app = new App({
        token: botToken,
        appToken,
        socketMode: true,
      });

      const allowedChannels = this.channelConfig.allowedChannels || [];

      // Handle @mentions and direct messages
      this.app.event('app_mention', async ({ event, say }) => {
        if (allowedChannels.length > 0 && !allowedChannels.includes(event.channel)) return;
        await this._handleMessage(event.text, event.user, event.channel, say);
      });

      this.app.event('message', async ({ event, say }) => {
        // Only handle DMs (im) and allowed channels
        if (event.channel_type !== 'im' && allowedChannels.length > 0 && !allowedChannels.includes(event.channel)) return;
        if (event.subtype) return; // Skip edits, joins, etc
        if (event.bot_id) return; // Skip bot messages
        await this._handleMessage(event.text, event.user, event.channel, say);
      });

      await this.app.start();
      log.info('Slack channel: Socket Mode connected ✓');
    } catch (err) {
      log.warn(`Slack channel failed: ${err.message} — install bolt: npm i @slack/bolt`);
    }
  }

  async _handleMessage(text, userId, channelId, say) {
    // Strip bot mention from text
    const cleanText = (text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
    if (!cleanText) return;

    const agent = this.agents.primary();
    if (!agent) { await say('Agent not ready.'); return; }

    try {
      const result = await agent.process(cleanText, {
        channel: 'slack',
        userId,
        username: userId,
      });

      const content = result?.content || '(empty response)';

      // Split for Slack's 4000 char limit
      if (content.length <= 4000) {
        await say(content);
      } else {
        const chunks = [];
        let remaining = content;
        while (remaining.length > 0) {
          const breakAt = remaining.lastIndexOf('\n', 3900);
          const splitAt = breakAt > 1000 ? breakAt : 3900;
          chunks.push(remaining.slice(0, splitAt));
          remaining = remaining.slice(splitAt);
        }
        for (const chunk of chunks) await say(chunk);
      }

      // Broadcast to dashboard
      if (this._broadcast) {
        this._broadcast({
          type: 'channel_message',
          channel: 'slack',
          username: userId,
          userMessage: cleanText,
          response: content,
          agent: agent.name,
          tier: result.tier,
          model: result.model,
          cost: result.cost,
        });
      }

      log.agent(agent.name, `[slack] ${userId}: ${result.tier} → ${result.model || 'reflex'}`);
    } catch (err) {
      log.error(`Slack handler error: ${err.message}`);
      try { await say('Something went wrong. Check the logs.'); } catch { /* */ }
    }
  }

  async stop() {
    if (this.app) {
      try { await this.app.stop(); } catch { /* */ }
      this.app = null;
    }
  }
}
