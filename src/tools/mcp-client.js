/**
 * QuantumClaw — MCP Client
 *
 * Connects to MCP (Model Context Protocol) servers and exposes their
 * tools for the agent to use. Supports both transports:
 *
 *   stdio  — local process (e.g. npx @anthropic/mcp-server-filesystem)
 *   SSE    — remote HTTP (e.g. https://mcp.slack.com/sse)
 *
 * MCP spec: https://modelcontextprotocol.io
 * Zero external dependencies — uses native fetch + child_process.
 */

import { spawn } from 'child_process';
import { log } from '../core/logger.js';
import { randomUUID } from 'crypto';

export class MCPClient {
  constructor(serverConfig) {
    this.name = serverConfig.name;
    this.transport = serverConfig.transport || 'stdio'; // 'stdio' | 'sse'
    this.command = serverConfig.command;   // for stdio: "npx @modelcontextprotocol/server-filesystem /"
    this.args = serverConfig.args || [];
    this.env = serverConfig.env || {};
    this.url = serverConfig.url;           // for SSE: "https://mcp.example.com/sse"
    this.headers = serverConfig.headers || {};

    this._process = null;
    this._buffer = '';
    this._pending = new Map();  // id -> { resolve, reject, timeout }
    this._tools = [];
    this._connected = false;
    this._sseController = null;
  }

  /**
   * Connect to the MCP server and discover tools
   */
  async connect() {
    try {
      if (this.transport === 'sse') {
        await this._connectSSE();
      } else {
        await this._connectStdio();
      }

      // Initialize the connection
      const initResult = await this._request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'quantumclaw', version: '1.1.4' }
      });

      // Send initialized notification
      this._notify('notifications/initialized', {});

      // Discover tools
      const toolsResult = await this._request('tools/list', {});
      this._tools = (toolsResult.tools || []).map(t => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
        server: this.name,
      }));

      this._connected = true;
      log.debug(`MCP [${this.name}]: ${this._tools.length} tools discovered`);
      return this._tools;

    } catch (err) {
      log.warn(`MCP [${this.name}]: connection failed — ${err.message}`);
      this._connected = false;
      return [];
    }
  }

  /**
   * Call a tool on this server
   */
  async callTool(toolName, args = {}) {
    if (!this._connected) throw new Error(`MCP [${this.name}] not connected`);

    const result = await this._request('tools/call', {
      name: toolName,
      arguments: args,
    });

    // MCP returns content as array of { type, text } blocks
    if (Array.isArray(result.content)) {
      return result.content
        .map(c => c.type === 'text' ? c.text : JSON.stringify(c))
        .join('\n');
    }
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  get tools() { return this._tools; }
  get connected() { return this._connected; }

  async disconnect() {
    this._connected = false;
    if (this._process) {
      this._process.kill();
      this._process = null;
    }
    if (this._sseController) {
      this._sseController.abort();
      this._sseController = null;
    }
    for (const [, pending] of this._pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Disconnected'));
    }
    this._pending.clear();
  }

  // ─── Stdio Transport ────────────────────────────────────

  async _connectStdio() {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...this.env };

      this._process = spawn(this.command, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        shell: true,
      });

      this._process.stdout.on('data', (data) => {
        this._buffer += data.toString();
        this._processBuffer();
      });

      this._process.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) log.debug(`MCP [${this.name}] stderr: ${msg}`);
      });

      this._process.on('error', (err) => {
        log.warn(`MCP [${this.name}] process error: ${err.message}`);
        this._connected = false;
        reject(err);
      });

      this._process.on('close', (code) => {
        log.debug(`MCP [${this.name}] process exited (${code})`);
        this._connected = false;
      });

      // Give server time to start
      setTimeout(resolve, 500);
    });
  }

  _processBuffer() {
    // MCP uses JSON-RPC over newline-delimited JSON
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop() || ''; // keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);
        this._handleMessage(msg);
      } catch {
        // Not JSON — might be a log line from the server
      }
    }
  }

  _sendStdio(msg) {
    if (!this._process?.stdin?.writable) throw new Error('Process not running');
    this._process.stdin.write(JSON.stringify(msg) + '\n');
  }

  // ─── SSE Transport ──────────────────────────────────────

  async _connectSSE() {
    this._sseController = new AbortController();
    this._sseEndpoint = null;

    // SSE connection to receive messages
    const res = await fetch(this.url, {
      headers: { ...this.headers, 'Accept': 'text/event-stream' },
      signal: this._sseController.signal,
    });

    if (!res.ok) throw new Error(`SSE connect failed: ${res.status}`);

    // Read the SSE stream in background
    this._readSSEStream(res.body);

    // Wait for the endpoint event
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('SSE endpoint timeout')), 10000);
      const check = setInterval(() => {
        if (this._sseEndpoint) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);
    });
  }

  async _readSSEStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          const lines = event.split('\n');
          let eventType = 'message';
          let data = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7);
            if (line.startsWith('data: ')) data += line.slice(6);
          }

          if (eventType === 'endpoint' && data) {
            // The server tells us where to POST requests
            const baseUrl = new URL(this.url);
            this._sseEndpoint = data.startsWith('http')
              ? data
              : `${baseUrl.origin}${data}`;
          } else if (eventType === 'message' && data) {
            try {
              this._handleMessage(JSON.parse(data));
            } catch { /* not JSON */ }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        log.debug(`MCP [${this.name}] SSE stream ended: ${err.message}`);
      }
    }
  }

  async _sendSSE(msg) {
    if (!this._sseEndpoint) throw new Error('No SSE endpoint');

    const res = await fetch(this._sseEndpoint, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });

    if (!res.ok) throw new Error(`SSE POST failed: ${res.status}`);
  }

  // ─── JSON-RPC ───────────────────────────────────────────

  _handleMessage(msg) {
    // Response to a request we sent
    if (msg.id && this._pending.has(msg.id)) {
      const { resolve, reject, timeout } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      clearTimeout(timeout);

      if (msg.error) {
        reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
      } else {
        resolve(msg.result || {});
      }
    }
    // Server-initiated notification (we can ignore most of these)
  }

  _request(method, params, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const msg = { jsonrpc: '2.0', id, method, params };

      const timeout = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`MCP [${this.name}] ${method} timed out`));
      }, timeoutMs);

      this._pending.set(id, { resolve, reject, timeout });

      if (this.transport === 'sse') {
        this._sendSSE(msg).catch(reject);
      } else {
        try { this._sendStdio(msg); } catch (err) { reject(err); }
      }
    });
  }

  _notify(method, params) {
    const msg = { jsonrpc: '2.0', method, params };
    if (this.transport === 'sse') {
      this._sendSSE(msg).catch(() => {});
    } else {
      try { this._sendStdio(msg); } catch { /* best effort */ }
    }
  }
}
