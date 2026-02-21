#!/usr/bin/env node
/**
 * QuantumClaw TUI — Terminal User Interface
 *
 * For Android/Termux where browser dashboards are impractical.
 * Chat with your agent, approve Telegram pairings, view status.
 *
 * Usage: qclaw tui
 *
 * Zero external dependencies — pure Node.js readline + ANSI.
 */

import { createInterface } from 'readline';
import { loadConfig } from '../core/config.js';

// ─── ANSI Codes ──────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  purple: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgPurple: '\x1b[45m',
  bgDark: '\x1b[40m',
  clear: '\x1b[2J\x1b[H',
  up: (n) => `\x1b[${n}A`,
  clearLine: '\x1b[2K',
};

const w = (t) => process.stdout.write(t);

// ─── State ───────────────────────────────────────────────
let config;
let baseUrl;
let token;
let mode = 'chat'; // chat | status | pairing
let messages = [];
let pendingPairings = [];
let ws = null;
let wsConnected = false;

// ─── Init ────────────────────────────────────────────────
export async function startTUI() {
  config = await loadConfig();
  const port = config.dashboard?.port || 3000;
  token = config.dashboard?.authToken || '';
  baseUrl = `http://localhost:${port}`;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
  });

  // Clear screen and show header
  drawScreen();

  // Connect WebSocket for real-time chat
  connectWS(port);

  // Poll for pairings
  const pairingInterval = setInterval(checkPairings, 10000);
  checkPairings();

  // Input handler
  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { drawPrompt(); return; }

    // Commands
    if (input === '/quit' || input === '/q') {
      w(`\n${C.dim}Goodbye.${C.reset}\n`);
      if (ws) ws.close();
      clearInterval(pairingInterval);
      rl.close();
      process.exit(0);
    }

    if (input === '/status' || input === '/s') {
      await showStatus();
      drawPrompt();
      return;
    }

    if (input === '/pair' || input === '/p') {
      await showPairings();
      drawPrompt();
      return;
    }

    if (input.startsWith('/approve ')) {
      const code = input.split(' ')[1];
      await approvePairing(code);
      drawPrompt();
      return;
    }

    if (input === '/help' || input === '/h') {
      showHelp();
      drawPrompt();
      return;
    }

    if (input === '/clear') {
      messages = [];
      drawScreen();
      return;
    }

    // Regular chat message
    addMessage('you', input);
    sendMessage(input);
  });

  rl.on('close', () => {
    if (ws) ws.close();
    clearInterval(pairingInterval);
    process.exit(0);
  });

  // Handle resize
  process.stdout.on('resize', () => drawScreen());
}

// ─── WebSocket ───────────────────────────────────────────
function connectWS(port) {
  try {
    // Dynamic import to avoid crash if ws not available
    import('ws').then(({ default: WebSocket }) => {
      const url = `ws://localhost:${port}/ws${token ? '?token=' + token : ''}`;
      ws = new WebSocket(url);

      ws.on('open', () => {
        wsConnected = true;
        drawStatusBar();
      });

      ws.on('message', (data) => {
        try {
          const d = JSON.parse(data.toString());
          if (d.type === 'typing') {
            showTyping();
          } else if (d.type === 'response') {
            hideTyping();
            const meta = d.model ? `${d.tier} → ${d.model}` : 'reflex';
            addMessage('agent', d.content, meta);
          } else if (d.type === 'error') {
            hideTyping();
            addMessage('error', d.error);
          }
        } catch {}
      });

      ws.on('close', () => {
        wsConnected = false;
        drawStatusBar();
        // Reconnect after 3s
        setTimeout(() => connectWS(port), 3000);
      });

      ws.on('error', () => {
        wsConnected = false;
      });
    }).catch(() => {
      // ws module not available — fall back to HTTP
      wsConnected = false;
    });
  } catch {
    wsConnected = false;
  }
}

function sendMessage(text) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ message: text }));
  } else {
    // Fallback: HTTP
    fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ message: text }),
    })
      .then(r => r.json())
      .then(d => addMessage('agent', d.content || d.text || JSON.stringify(d)))
      .catch(e => addMessage('error', `Request failed: ${e.message}`));
  }
}

// ─── Pairing ─────────────────────────────────────────────
async function checkPairings() {
  try {
    const r = await fetch(`${baseUrl}/api/pairing/pending`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) {
      const d = await r.json();
      if (d.length > 0 && d.length !== pendingPairings.length) {
        pendingPairings = d;
        showPairingAlert();
      } else if (d.length === 0) {
        pendingPairings = [];
      }
    }
  } catch {}
}

function showPairingAlert() {
  w('\n');
  w(`  ${C.bgPurple}${C.white}${C.bold} 🔐 PAIRING REQUEST ${C.reset}\n`);
  for (const p of pendingPairings) {
    const age = Math.round((Date.now() - p.timestamp) / 60000);
    w(`  ${C.yellow}@${p.username || 'unknown'}${C.reset} on ${C.cyan}${p.channel}${C.reset} — code: ${C.bold}${p.code}${C.reset} (${age}m ago)\n`);
  }
  w(`  ${C.dim}Type: /approve ${pendingPairings[0]?.code || 'CODE'}${C.reset}\n`);
  w('\n');
  drawPrompt();
}

async function showPairings() {
  await checkPairings();
  w('\n');
  if (pendingPairings.length === 0) {
    w(`  ${C.dim}No pending pairing requests.${C.reset}\n`);
    w(`  ${C.dim}Send /start to your Telegram bot to initiate pairing.${C.reset}\n`);
  } else {
    w(`  ${C.bold}Pending Pairings:${C.reset}\n`);
    for (const p of pendingPairings) {
      const age = Math.round((Date.now() - p.timestamp) / 60000);
      w(`  ${C.yellow}@${p.username || 'unknown'}${C.reset} (${p.channel}) — ${C.bold}${p.code}${C.reset} — ${age}m ago\n`);
    }
    w(`\n  ${C.dim}/approve CODE to approve${C.reset}\n`);
  }
  w('\n');
}

async function approvePairing(code) {
  try {
    // Find which channel this code belongs to
    const p = pendingPairings.find(x => x.code === code);
    const channel = p?.channel || 'telegram';

    const r = await fetch(`${baseUrl}/api/pairing/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, code }),
    });

    if (r.ok) {
      const d = await r.json();
      w(`\n  ${C.green}✓ Paired!${C.reset} @${d.username || 'user'} on ${channel}\n`);
      w(`  ${C.dim}They can now send messages to your agent.${C.reset}\n\n`);
      pendingPairings = pendingPairings.filter(x => x.code !== code);
    } else {
      w(`\n  ${C.red}✗ Pairing failed${C.reset} — code expired or not found\n\n`);
    }
  } catch (e) {
    w(`\n  ${C.red}✗ Error:${C.reset} ${e.message}\n\n`);
  }
}

// ─── Status ──────────────────────────────────────────────
async function showStatus() {
  w('\n');
  try {
    const r = await fetch(`${baseUrl}/api/health`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    const d = await r.json();

    w(`  ${C.bold}QuantumClaw Status${C.reset}\n`);
    w(`  ${C.dim}${'─'.repeat(36)}${C.reset}\n`);
    w(`  ${C.green}●${C.reset} Agent: ${C.bold}Running${C.reset} (degradation ${d.degradationLevel}/5)\n`);
    w(`  ${d.cognee ? C.green + '●' : C.yellow + '○'} ${C.reset}Memory: ${d.cognee ? 'Cognee' : 'Vector + local'}\n`);
    w(`  ${C.green}●${C.reset} AGEX: ${d.agex?.mode || 'local'}\n`);
    w(`  ${d.tunnel ? C.green + '●' : C.dim + '○'} ${C.reset}Tunnel: ${d.tunnel || 'none'}\n`);
    w(`  ${C.green}●${C.reset} Agents: ${d.agents || 0}\n`);
  } catch (e) {
    w(`  ${C.red}✗ Agent not reachable${C.reset}\n`);
    w(`  ${C.dim}Is the agent running? Try: qclaw start${C.reset}\n`);
  }
  w('\n');
}

// ─── Drawing ─────────────────────────────────────────────
function drawScreen() {
  w(C.clear);
  drawHeader();
  drawMessages();
  drawPrompt();
}

function drawHeader() {
  const cols = process.stdout.columns || 80;
  const line = '─'.repeat(Math.min(cols - 4, 60));

  w(`\n  ${C.purple}${C.bold}⚛ QuantumClaw TUI${C.reset}\n`);
  w(`  ${C.dim}${line}${C.reset}\n`);
  drawStatusBar();
  w(`  ${C.dim}/help for commands${C.reset}\n\n`);
}

function drawStatusBar() {
  const status = wsConnected
    ? `${C.green}● connected${C.reset}`
    : `${C.red}● disconnected${C.reset}`;
  const pairCount = pendingPairings.length;
  const pairBadge = pairCount > 0
    ? `  ${C.yellow}🔐 ${pairCount} pairing${pairCount > 1 ? 's' : ''}${C.reset}`
    : '';

  // Don't clear the whole screen, just show inline
  w(`  ${status}${pairBadge}\n`);
}

function drawMessages() {
  // Show last N messages that fit
  const rows = (process.stdout.rows || 24) - 10;
  const visible = messages.slice(-Math.max(rows, 5));

  for (const m of visible) {
    if (m.role === 'you') {
      w(`  ${C.purple}${C.bold}You${C.reset} ${C.dim}${m.time}${C.reset}\n`);
      w(`  ${m.text}\n\n`);
    } else if (m.role === 'agent') {
      w(`  ${C.cyan}${C.bold}Agent${C.reset} ${C.dim}${m.time}${m.meta ? ' · ' + m.meta : ''}${C.reset}\n`);
      // Word wrap agent responses
      const maxW = (process.stdout.columns || 80) - 6;
      const lines = wordWrap(m.text, maxW);
      for (const line of lines) {
        w(`  ${line}\n`);
      }
      w('\n');
    } else if (m.role === 'error') {
      w(`  ${C.red}Error:${C.reset} ${m.text}\n\n`);
    }
  }
}

function drawPrompt() {
  w(`${C.purple}❯${C.reset} `);
}

function addMessage(role, text, meta = '') {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  messages.push({ role, text, meta, time });

  // Don't redraw whole screen — just append
  if (role === 'you') {
    // Already echoed by readline
  } else if (role === 'agent') {
    w(`\n  ${C.cyan}${C.bold}Agent${C.reset} ${C.dim}${time}${meta ? ' · ' + meta : ''}${C.reset}\n`);
    const maxW = (process.stdout.columns || 80) - 6;
    const lines = wordWrap(text, maxW);
    for (const line of lines) {
      w(`  ${line}\n`);
    }
    w('\n');
    drawPrompt();
  } else if (role === 'error') {
    w(`\n  ${C.red}Error:${C.reset} ${text}\n\n`);
    drawPrompt();
  }
}

let typingShown = false;
function showTyping() {
  if (!typingShown) {
    w(`\n  ${C.dim}Thinking...${C.reset}`);
    typingShown = true;
  }
}
function hideTyping() {
  if (typingShown) {
    w(`\r${C.clearLine}`);
    typingShown = false;
  }
}

function showHelp() {
  w('\n');
  w(`  ${C.bold}Commands${C.reset}\n`);
  w(`  ${C.dim}${'─'.repeat(30)}${C.reset}\n`);
  w(`  ${C.cyan}/status${C.reset}  ${C.dim}/${C.reset}s   Agent health\n`);
  w(`  ${C.cyan}/pair${C.reset}    ${C.dim}/${C.reset}p   Show pending pairings\n`);
  w(`  ${C.cyan}/approve${C.reset} CODE  Approve a pairing\n`);
  w(`  ${C.cyan}/clear${C.reset}         Clear chat\n`);
  w(`  ${C.cyan}/help${C.reset}    ${C.dim}/${C.reset}h   This help\n`);
  w(`  ${C.cyan}/quit${C.reset}    ${C.dim}/${C.reset}q   Exit\n`);
  w(`\n  ${C.dim}Or just type to chat with your agent.${C.reset}\n`);
  w('\n');
}

function wordWrap(text, maxWidth) {
  if (!text) return [''];
  const lines = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length <= maxWidth) {
      lines.push(paragraph);
      continue;
    }
    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      if ((current + ' ' + word).trim().length > maxWidth) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = current ? current + ' ' + word : word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// Run if called directly
if (process.argv[1]?.endsWith('tui.js')) {
  startTUI();
}
