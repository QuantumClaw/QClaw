/**
 * QuantumClaw — Tool Registry
 *
 * Manages all tools available to the agent:
 *   1. Built-in tools (web search, calculator, etc.)
 *   2. MCP server tools (filesystem, GitHub, etc.)
 *   3. Skill-defined API tools (from markdown skill files)
 *
 * Pre-configured MCP servers:
 *   Users just run `qclaw tool enable github` and paste their token.
 *   No config files. No URLs. No setup guides.
 *
 * Custom MCP servers:
 *   Users can add any MCP server with `qclaw tool add <name> <command>`.
 */

import { MCPClient } from './mcp-client.js';
import { log } from '../core/logger.js';
import { appendFileSync, chmodSync, existsSync, mkdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

/**
 * Per-preset scope map. Domain tools (stripe, ghl) scope to the build/
 * operator agent currently consuming them; utility presets are 'shared'.
 * Slice 3b will couple this to per-agent skill loading; Slice 6 narrows
 * Stripe/GHL further to per-business-unit operators.
 */
const PRESET_SCOPE_MAP = {
  stripe: ['charlie'],
  ghl: ['charlie'],
};

/**
 * Resolve the absolute path for the tool-call.log file.
 * Tests can override via QCLAW_TOOL_CALL_LOG_PATH; otherwise it lives
 * alongside audit.db in ~/.quantumclaw/.
 */
function _toolCallLogPath() {
  return process.env.QCLAW_TOOL_CALL_LOG_PATH
    || join(homedir(), '.quantumclaw', 'tool-call.log');
}

/**
 * Append one JSON Lines record to tool-call.log. Mode-locked to 0600 on
 * first write. Best-effort: failures are warned and swallowed so they
 * never block tool registration.
 *
 * Slice 3a scope: only emits 'registration' events. Slice 3b extends to
 * routing decisions; Slice 3c covers per-call audit.
 */
function _appendToolCallLog(record) {
  try {
    const path = _toolCallLogPath();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n';
    const existed = existsSync(path);
    appendFileSync(path, line);
    if (!existed) {
      try { chmodSync(path, 0o600); } catch { /* non-fatal */ }
    }
  } catch (err) {
    log.warn(`[ToolRegistry] tool-call.log write failed: ${err.message}`);
  }
}

/**
 * Validate a scope field. Throws on missing/invalid input. Accepts
 * either the literal 'shared' or a non-empty array of agent names.
 */
function _validateScope(scope, where) {
  if (scope === 'shared') return scope;
  if (Array.isArray(scope) && scope.length > 0 && scope.every(s => typeof s === 'string' && s.length > 0)) {
    return scope;
  }
  throw new Error(`[ToolRegistry] ${where}: scope must be 'shared' or a non-empty array of agent names, got ${JSON.stringify(scope)}`);
}

/**
 * Pre-configured MCP servers.
 * Users just need an API key/token — everything else is preset.
 *
 * Format:
 *   name: display name
 *   description: what it does
 *   transport: 'stdio' | 'sse'
 *   command/args: for stdio servers
 *   url: for SSE servers
 *   envKey: the env var name the server expects for auth
 *   secretKey: what we store the key as in QClaw secrets
 *   npm: npm package to install (for stdio servers)
 *   setup: human-readable setup instructions
 */
export const PRESET_SERVERS = {

  // ─── MCP SERVERS (stdio — run as local processes) ──────────

  brave: {
    name: 'Brave Search',
    type: 'mcp',
    description: 'Web search via Brave Search API',
    transport: 'stdio',
    npm: '@modelcontextprotocol/server-brave-search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envKey: 'BRAVE_API_KEY',
    secretKey: 'brave_api_key',
    setup: 'Get a free API key at https://brave.com/search/api/',
    requiresKey: true,
  },

  github: {
    name: 'GitHub',
    type: 'mcp',
    description: 'Manage repos, issues, PRs, code search',
    transport: 'stdio',
    npm: '@modelcontextprotocol/server-github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envKey: 'GITHUB_PERSONAL_ACCESS_TOKEN',
    secretKey: 'github_token',
    setup: 'Create a token at https://github.com/settings/tokens (repo + read:org)',
    requiresKey: true,
  },

  google_drive: {
    name: 'Google Drive',
    type: 'mcp',
    description: 'Search and read Google Drive files',
    transport: 'stdio',
    npm: '@anthropic/mcp-server-google-drive',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-google-drive'],
    envKey: 'GOOGLE_APPLICATION_CREDENTIALS',
    secretKey: 'google_drive_credentials',
    setup: 'Create a service account at https://console.cloud.google.com/iam-admin/serviceaccounts',
    requiresKey: true,
  },

  memory: {
    name: 'Memory',
    type: 'mcp',
    description: 'Persistent key-value memory across conversations',
    transport: 'stdio',
    npm: '@modelcontextprotocol/server-memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    envKey: null,
    secretKey: null,
    setup: 'Gives your agent persistent memory storage.',
    requiresKey: false,
  },

  fetch: {
    name: 'Web Fetch',
    type: 'mcp',
    description: 'Fetch and read any URL or webpage',
    transport: 'stdio',
    npm: '@modelcontextprotocol/server-fetch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    envKey: null,
    secretKey: null,
    setup: 'Lets your agent read any URL on the web.',
    requiresKey: false,
  },

  postgres: {
    name: 'PostgreSQL',
    type: 'mcp',
    description: 'Query and manage PostgreSQL databases',
    transport: 'stdio',
    npm: '@modelcontextprotocol/server-postgres',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '{connection_string}'],
    envKey: null,
    secretKey: 'postgres_url',
    setup: 'Enter your PostgreSQL connection string (postgresql://user:pass@host/db)',
    requiresKey: true,
  },

  sqlite: {
    name: 'SQLite',
    type: 'mcp',
    description: 'Query and manage SQLite databases',
    transport: 'stdio',
    npm: '@modelcontextprotocol/server-sqlite',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '{db_path}'],
    envKey: null,
    secretKey: 'sqlite_db_path',
    setup: 'Enter the path to your SQLite database file',
    requiresKey: true,
  },

  puppeteer: {
    name: 'Browser',
    type: 'mcp',
    description: 'Control a web browser — navigate, click, screenshot, scrape',
    transport: 'stdio',
    npm: '@modelcontextprotocol/server-puppeteer',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    envKey: null,
    secretKey: null,
    setup: 'Gives your agent a headless browser. Requires Chrome/Chromium installed.',
    requiresKey: false,
  },

  notion: {
    name: 'Notion',
    type: 'mcp',
    description: 'Search, read and update Notion pages and databases',
    transport: 'stdio',
    npm: '@notionhq/mcp-server-notion',
    command: 'npx',
    args: ['-y', '@notionhq/mcp-server-notion'],
    envKey: 'NOTION_API_KEY',
    secretKey: 'notion_api_key',
    setup: 'Create an integration at https://www.notion.so/my-integrations and copy the Internal Integration Secret',
    requiresKey: true,
  },

  linear: {
    name: 'Linear',
    type: 'mcp',
    description: 'Manage issues, projects and cycles in Linear',
    transport: 'stdio',
    npm: '@anthropic/mcp-server-linear',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-linear'],
    envKey: 'LINEAR_API_KEY',
    secretKey: 'linear_api_key',
    setup: 'Get your API key from Linear Settings > API > Personal API Keys',
    requiresKey: true,
  },

  sentry: {
    name: 'Sentry',
    type: 'mcp',
    description: 'Query error reports, issues and performance data from Sentry',
    transport: 'stdio',
    npm: '@sentry/mcp-server-sentry',
    command: 'npx',
    args: ['-y', '@sentry/mcp-server-sentry'],
    envKey: 'SENTRY_AUTH_TOKEN',
    secretKey: 'sentry_token',
    setup: 'Create a token at https://sentry.io/settings/auth-tokens/',
    requiresKey: true,
  },

  // ─── API TOOLS (direct HTTP — no MCP process needed) ───────

  google_places: {
    name: 'Google Places',
    type: 'api',
    description: 'Search places, businesses, restaurants. Get reviews, hours, photos, directions',
    baseUrl: 'https://places.googleapis.com/v1',
    secretKey: 'google_places_api_key',
    setup: 'Get an API key at https://console.cloud.google.com/apis/credentials (enable Places API)',
    requiresKey: true,
    tools: [
      {
        name: 'search_places',
        description: 'Search for places, businesses, restaurants by text query. Returns name, address, rating, hours.',
        inputSchema: { type: 'object', properties: {
          query: { type: 'string', description: 'Search query (e.g. "coffee shops in Manchester")' },
          maxResults: { type: 'number', description: 'Max results to return (1-20, default 5)' },
        }, required: ['query'] },
      },
      {
        name: 'place_details',
        description: 'Get detailed info about a specific place: reviews, phone, website, hours, photos',
        inputSchema: { type: 'object', properties: {
          placeId: { type: 'string', description: 'Google Place ID from a search result' },
        }, required: ['placeId'] },
      },
      {
        name: 'nearby_places',
        description: 'Find places near a location by type (restaurant, hospital, atm, etc.)',
        inputSchema: { type: 'object', properties: {
          latitude: { type: 'number', description: 'Latitude' },
          longitude: { type: 'number', description: 'Longitude' },
          type: { type: 'string', description: 'Place type (restaurant, cafe, hospital, atm, gym, etc.)' },
          radius: { type: 'number', description: 'Search radius in metres (default 1500)' },
        }, required: ['latitude', 'longitude', 'type'] },
      },
    ],
  },

  google_calendar: {
    name: 'Google Calendar',
    type: 'api',
    description: 'Read, create, update and delete calendar events',
    baseUrl: 'https://www.googleapis.com/calendar/v3',
    secretKey: 'google_calendar_token',
    setup: 'OAuth setup needed — run qclaw tool enable google_calendar and follow the prompts',
    requiresKey: true,
    tools: [
      {
        name: 'list_events',
        description: 'List upcoming calendar events. Returns title, time, attendees, location.',
        inputSchema: { type: 'object', properties: {
          maxResults: { type: 'number', description: 'Max events (default 10)' },
          timeMin: { type: 'string', description: 'Start time (ISO 8601). Default: now' },
          timeMax: { type: 'string', description: 'End time (ISO 8601). Default: 7 days from now' },
        }},
      },
      {
        name: 'create_event',
        description: 'Create a new calendar event',
        inputSchema: { type: 'object', properties: {
          summary: { type: 'string', description: 'Event title' },
          start: { type: 'string', description: 'Start time (ISO 8601)' },
          end: { type: 'string', description: 'End time (ISO 8601)' },
          description: { type: 'string', description: 'Event description' },
          location: { type: 'string', description: 'Event location' },
          attendees: { type: 'string', description: 'Comma-separated email addresses' },
        }, required: ['summary', 'start', 'end'] },
      },
    ],
  },

  openweather: {
    name: 'Weather',
    type: 'api',
    description: 'Get current weather, forecasts, and alerts for any location',
    baseUrl: 'https://api.openweathermap.org/data/2.5',
    secretKey: 'openweather_api_key',
    setup: 'Get a free API key at https://openweathermap.org/api (free tier: 1000 calls/day)',
    requiresKey: true,
    tools: [
      {
        name: 'get_weather',
        description: 'Get current weather for a city or coordinates. Returns temperature, conditions, wind, humidity.',
        inputSchema: { type: 'object', properties: {
          city: { type: 'string', description: 'City name (e.g. "London" or "London,GB")' },
          lat: { type: 'number', description: 'Latitude (alternative to city)' },
          lon: { type: 'number', description: 'Longitude (alternative to city)' },
          units: { type: 'string', description: 'Temperature units: metric (°C), imperial (°F). Default: metric' },
        }},
      },
      {
        name: 'get_forecast',
        description: 'Get 5-day weather forecast with 3-hour intervals',
        inputSchema: { type: 'object', properties: {
          city: { type: 'string', description: 'City name' },
          units: { type: 'string', description: 'metric or imperial' },
        }, required: ['city'] },
      },
    ],
  },

  news: {
    name: 'News',
    type: 'api',
    description: 'Search news articles, get top headlines from 80,000+ sources',
    baseUrl: 'https://newsapi.org/v2',
    secretKey: 'newsapi_key',
    setup: 'Get a free API key at https://newsapi.org/register (free tier: 100 requests/day)',
    requiresKey: true,
    tools: [
      {
        name: 'search_news',
        description: 'Search news articles by keyword, date range, source, or language',
        inputSchema: { type: 'object', properties: {
          query: { type: 'string', description: 'Search keywords' },
          from: { type: 'string', description: 'From date (YYYY-MM-DD)' },
          to: { type: 'string', description: 'To date (YYYY-MM-DD)' },
          sortBy: { type: 'string', description: 'relevancy, popularity, or publishedAt' },
          language: { type: 'string', description: 'Language code (en, es, fr, etc.)' },
        }, required: ['query'] },
      },
      {
        name: 'top_headlines',
        description: 'Get current top headlines by country or category',
        inputSchema: { type: 'object', properties: {
          country: { type: 'string', description: 'Country code (gb, us, etc.)' },
          category: { type: 'string', description: 'business, technology, sports, health, science, entertainment' },
        }},
      },
    ],
  },

  google_maps: {
    name: 'Google Maps',
    type: 'api',
    description: 'Directions, distance, geocoding, route planning',
    baseUrl: 'https://maps.googleapis.com/maps/api',
    secretKey: 'google_maps_api_key',
    setup: 'Get an API key at https://console.cloud.google.com/apis/credentials (enable Directions + Geocoding APIs)',
    requiresKey: true,
    tools: [
      {
        name: 'get_directions',
        description: 'Get directions between two places with distance, duration, and step-by-step route',
        inputSchema: { type: 'object', properties: {
          origin: { type: 'string', description: 'Starting point (address or place)' },
          destination: { type: 'string', description: 'Destination (address or place)' },
          mode: { type: 'string', description: 'driving, walking, bicycling, or transit (default: driving)' },
        }, required: ['origin', 'destination'] },
      },
      {
        name: 'geocode',
        description: 'Convert address to coordinates or coordinates to address',
        inputSchema: { type: 'object', properties: {
          address: { type: 'string', description: 'Address to geocode' },
          lat: { type: 'number', description: 'Latitude (for reverse geocoding)' },
          lng: { type: 'number', description: 'Longitude (for reverse geocoding)' },
        }},
      },
    ],
  },

  exchangerate: {
    name: 'Currency Exchange',
    type: 'api',
    description: 'Real-time currency conversion and exchange rates',
    baseUrl: 'https://api.exchangerate-api.com/v4',
    secretKey: null,
    setup: 'No API key needed — free unlimited access',
    requiresKey: false,
    tools: [
      {
        name: 'convert_currency',
        description: 'Convert between currencies. Supports 150+ currencies.',
        inputSchema: { type: 'object', properties: {
          from: { type: 'string', description: 'Source currency code (e.g. GBP, USD, EUR)' },
          to: { type: 'string', description: 'Target currency code' },
          amount: { type: 'number', description: 'Amount to convert (default 1)' },
        }, required: ['from', 'to'] },
      },
    ],
  },

  youtube: {
    name: 'YouTube',
    type: 'api',
    description: 'Search videos, get channel info, video details and transcripts',
    baseUrl: 'https://www.googleapis.com/youtube/v3',
    secretKey: 'youtube_api_key',
    setup: 'Get an API key at https://console.cloud.google.com/apis/credentials (enable YouTube Data API v3)',
    requiresKey: true,
    tools: [
      {
        name: 'search_videos',
        description: 'Search YouTube videos by query. Returns title, channel, view count, duration.',
        inputSchema: { type: 'object', properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (1-25, default 5)' },
          order: { type: 'string', description: 'relevance, date, viewCount, or rating' },
        }, required: ['query'] },
      },
      {
        name: 'video_details',
        description: 'Get details about a specific YouTube video: description, stats, comments',
        inputSchema: { type: 'object', properties: {
          videoId: { type: 'string', description: 'YouTube video ID (e.g. dQw4w9WgXcQ)' },
        }, required: ['videoId'] },
      },
    ],
  },

  stripe: {
    name: 'Stripe',
    type: 'api',
    description: 'Check payments, customers, invoices, subscriptions',
    baseUrl: 'https://api.stripe.com/v1',
    secretKey: 'stripe_api_key',
    setup: 'Get your secret key from https://dashboard.stripe.com/apikeys (use restricted key for safety)',
    requiresKey: true,
    tools: [
      {
        name: 'list_payments',
        description: 'List recent payments/charges with status, amount, customer',
        inputSchema: { type: 'object', properties: {
          limit: { type: 'number', description: 'Number of payments (default 10)' },
          status: { type: 'string', description: 'Filter: succeeded, pending, failed' },
        }},
      },
      {
        name: 'list_customers',
        description: 'List customers with email, name, balance',
        inputSchema: { type: 'object', properties: {
          limit: { type: 'number', description: 'Number of customers (default 10)' },
          email: { type: 'string', description: 'Filter by email' },
        }},
      },
      {
        name: 'list_invoices',
        description: 'List invoices with status, amount, due date',
        inputSchema: { type: 'object', properties: {
          limit: { type: 'number', description: 'Number of invoices (default 10)' },
          status: { type: 'string', description: 'Filter: draft, open, paid, void, uncollectible' },
        }},
      },
    ],
  },

  ghl: {
    name: 'GoHighLevel',
    type: 'api',
    description: 'Manage contacts, opportunities, pipelines, conversations in GHL CRM',
    baseUrl: 'https://services.leadconnectorhq.com',
    secretKey: 'ghl_api_key',
    setup: 'Get your API key from GHL Settings > Business Profile > API Key, or use a Private Integration key',
    requiresKey: true,
    tools: [
      {
        name: 'search_contacts',
        description: 'Search GHL contacts by name, email, phone, or tag',
        inputSchema: { type: 'object', properties: {
          query: { type: 'string', description: 'Search query (name, email, phone)' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        }, required: ['query'] },
      },
      {
        name: 'get_contact',
        description: 'Get full contact details including tags, notes, opportunities',
        inputSchema: { type: 'object', properties: {
          contactId: { type: 'string', description: 'GHL contact ID' },
        }, required: ['contactId'] },
      },
      {
        name: 'list_opportunities',
        description: 'List opportunities in a pipeline with stage, value, contact',
        inputSchema: { type: 'object', properties: {
          pipelineId: { type: 'string', description: 'Pipeline ID' },
          stageId: { type: 'string', description: 'Filter by stage ID (optional)' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        }, required: ['pipelineId'] },
      },
      {
        name: 'list_pipelines',
        description: 'List all pipelines and their stages',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  },

  google_sheets: {
    name: 'Google Sheets',
    type: 'api',
    description: 'Read and write Google Sheets spreadsheets',
    baseUrl: 'https://sheets.googleapis.com/v4',
    secretKey: 'google_sheets_token',
    setup: 'OAuth setup needed — or use a service account key from Google Cloud Console',
    requiresKey: true,
    tools: [
      {
        name: 'read_sheet',
        description: 'Read data from a Google Sheet by range',
        inputSchema: { type: 'object', properties: {
          spreadsheetId: { type: 'string', description: 'Spreadsheet ID from the URL' },
          range: { type: 'string', description: 'Range (e.g. "Sheet1!A1:D10" or "Sheet1")' },
        }, required: ['spreadsheetId', 'range'] },
      },
      {
        name: 'write_sheet',
        description: 'Write data to a Google Sheet',
        inputSchema: { type: 'object', properties: {
          spreadsheetId: { type: 'string', description: 'Spreadsheet ID' },
          range: { type: 'string', description: 'Range to write to (e.g. "Sheet1!A1")' },
          values: { type: 'string', description: 'JSON array of arrays (e.g. [["Name","Score"],["Alice",95]])' },
        }, required: ['spreadsheetId', 'range', 'values'] },
      },
    ],
  },

  n8n: {
    name: 'n8n Webhooks',
    type: 'api',
    description: 'Trigger n8n workflows via webhook — connect to any automation',
    baseUrl: '{n8n_base_url}',
    secretKey: 'n8n_base_url',
    setup: 'Enter your n8n instance URL (e.g. https://your-n8n.app.n8n.cloud)',
    requiresKey: true,
    tools: [
      {
        name: 'trigger_webhook',
        description: 'Trigger an n8n webhook workflow with custom data',
        inputSchema: { type: 'object', properties: {
          webhookPath: { type: 'string', description: 'Webhook path (e.g. /webhook/my-flow)' },
          data: { type: 'string', description: 'JSON data to send to the webhook' },
        }, required: ['webhookPath'] },
      },
    ],
  },
};


export class ToolRegistry {
  constructor(config, secrets) {
    this.config = config;
    this.secrets = secrets;
    this._clients = new Map();   // name -> MCPClient
    this._tools = new Map();     // toolName -> { tool, client, scope }
    this._apiTools = new Map();  // toolName -> { preset, toolDef, scope }
    this._builtins = new Map();  // toolName -> { description, inputSchema, fn, scope }

    // Slice 3b: per-request active-tool gate. When null, every
    // registered tool is callable (legacy behaviour for boot-time
    // callers, CLI, dashboard). When a Set, only tools whose names
    // appear in the set are returned by getToolDefinitions() and
    // executeTool() returns a structured out_of_scope error for any
    // tool name outside the set. The set is computed per message by
    // registerForRequest(skillLoadResult, agentName) from
    // (a) every 'shared' scope tool, (b) every tool whose owning
    // skill is in the message's loaded skill set — explicit via the
    // skill's frontmatter `tools:` array, implicit via the
    // <agent>__<skill>__* and <skill>__* prefix conventions.
    this._activeForRequest = null;
    // Tools the current request explicitly activated (subset of
    // _activeForRequest), used for tool-call.log telemetry only.
    this._lastActivated = [];
  }

  /**
   * Initialize: connect to all enabled MCP servers and register API tools
   */
  async init() {
    // Register built-in tools
    this._registerBuiltins();

    // Connect to configured MCP servers and register API tools
    const mcpConfig = this.config.tools?.mcp || {};
    const enabled = Object.entries(mcpConfig).filter(([, v]) => v.enabled !== false);

    for (const [name, serverConf] of enabled) {
      try {
        const preset = PRESET_SERVERS[name];
        if (preset?.type === 'api') {
          await this._registerAPITools(name, preset);
        } else {
          await this._connectServer(name, serverConf);
        }
      } catch (err) {
        log.warn(`Tool [${name}]: failed to connect — ${err.message}`);
      }
    }

    const toolCount = this._tools.size + this._builtins.size + this._apiTools.size;
    if (toolCount > 0) {
      log.debug(`Tools: ${this._builtins.size} built-in, ${this._tools.size} MCP, ${this._apiTools.size} API (${this._clients.size} servers)`);
    }

    return { tools: toolCount, servers: this._clients.size };
  }

  /**
   * Get all tools formatted for LLM tool calling (Anthropic/OpenAI format)
   *
   * Slice 3b: when an active-set is in place (registerForRequest called),
   * filter the output to that set. When no active-set is set
   * (boot-time, dashboard /api/tools, CLI), all registered tools are
   * returned — legacy behaviour preserved.
   */
  getToolDefinitions(format = 'anthropic') {
    const tools = [];
    const active = this._activeForRequest;
    const isActive = (name) => active === null || active.has(name);

    // Built-in tools
    for (const [name, handler] of this._builtins) {
      if (!isActive(name)) continue;
      tools.push(this._formatTool(name, handler.description, handler.inputSchema, format));
    }

    // MCP tools
    for (const [fullName, { tool }] of this._tools) {
      if (!isActive(fullName)) continue;
      tools.push(this._formatTool(fullName, tool.description, tool.inputSchema, format));
    }

    // API tools
    for (const [name, { toolDef }] of this._apiTools) {
      if (!isActive(name)) continue;
      tools.push(this._formatTool(name, toolDef.description, toolDef.inputSchema, format));
    }

    return tools;
  }

  /**
   * Execute a tool call from the LLM
   *
   * Slice 3b: when an active-set is in place, tool calls whose name
   * isn't in the set return a structured {error: 'out_of_scope', ...}
   * shape rather than throwing. The shape is JSON-stringified by the
   * executor and surfaces back to the LLM as a tool result, so the
   * model can correct course (delegate, or rephrase to trigger the
   * skill).
   */
  async executeTool(toolName, args = {}) {
    const active = this._activeForRequest;
    if (active !== null && !active.has(toolName)) {
      return this._outOfScope(toolName);
    }

    // Built-in tool?
    if (this._builtins.has(toolName)) {
      const handler = this._builtins.get(toolName);
      return await handler.fn(args);
    }

    // API tool?
    if (this._apiTools.has(toolName)) {
      const { preset, toolDef } = this._apiTools.get(toolName);
      return await this._executeAPITool(preset, toolDef, args);
    }

    // MCP tool? (format: serverName__toolName)
    const [serverName, ...rest] = toolName.split('__');
    const mcpToolName = rest.join('__');

    if (this._clients.has(serverName)) {
      const client = this._clients.get(serverName);
      return await client.callTool(mcpToolName, args);
    }

    throw new Error(`Unknown tool: ${toolName}`);
  }

  /**
   * Compose the structured out-of-scope response. Surfaces a hint
   * about which skill or agent owns the tool, when derivable from the
   * registration record.
   */
  _outOfScope(toolName) {
    let suggestion = `Tool "${toolName}" is not available for the current message.`;
    const owner = this._lookupOwner(toolName);
    if (owner.kind === 'unknown') {
      suggestion = `Tool "${toolName}" does not exist. Check the tool list for available tools, or delegate via claude_code_dispatch if you need a tool that hasn't been built yet.`;
    } else if (owner.kind === 'skill') {
      suggestion = `Tool "${toolName}" is owned by the "${owner.skill}" skill, which is not routed for this message. Mention one of its keywords (${owner.keywords_hint}) to load it, or delegate.`;
    } else if (owner.kind === 'agent') {
      suggestion = `Tool "${toolName}" is scoped to agent(s) ${owner.scope.join(', ')}. Delegate to ${owner.scope[0]}.`;
    }
    return {
      error: 'out_of_scope',
      tool: toolName,
      suggestion,
    };
  }

  /**
   * Derive an owner hint for a tool name. Used only to build out_of_scope
   * suggestions — best-effort and side-effect-free.
   */
  _lookupOwner(toolName) {
    const entry = this._builtins.get(toolName)
      || this._apiTools.get(toolName)
      || this._tools.get(toolName);
    if (!entry) return { kind: 'unknown' };
    const scope = entry.scope;
    // Infer owning skill from the name. Tool names look like:
    //   <agent>__<skill>__<verb_path>  (skill HTTP)
    //   <skill>__<verb>                (preset, when preset name matches a skill)
    const parts = toolName.split('__');
    if (parts.length >= 3) {
      return { kind: 'skill', skill: parts[1], scope, keywords_hint: 'see the skill keywords' };
    }
    if (parts.length === 2) {
      return { kind: 'skill', skill: parts[0], scope, keywords_hint: 'see the skill keywords' };
    }
    if (Array.isArray(scope)) {
      return { kind: 'agent', scope };
    }
    return { kind: 'unknown' };
  }

  /**
   * Slice 3b — Per-request active-tool gate.
   *
   * Computes the set of tool names callable for the current message
   * from (a) every 'shared' scope tool, (b) every tool whose owning
   * skill is in the loaded skill set. Sets `_activeForRequest` to that
   * set, emits one tool-call.log record per skill-coupled tool
   * activated this turn, and returns a cleanup handle that resets the
   * gate. Callers MUST invoke the cleanup handle (try/finally) so
   * boot-time tool listing continues to work.
   *
   * @param {Object} skillLoadResult  output of loadSkills()
   * @param {string} agentName        agent driving this request
   * @returns {() => void}            cleanup handle
   */
  registerForRequest(skillLoadResult, agentName) {
    if (typeof agentName !== 'string' || !agentName) {
      throw new Error('[ToolRegistry] registerForRequest: agentName required');
    }
    if (!skillLoadResult || typeof skillLoadResult !== 'object') {
      throw new Error('[ToolRegistry] registerForRequest: skillLoadResult required');
    }

    const declared = new Set([
      ...(skillLoadResult.tools?.always_on || []),
      ...(skillLoadResult.tools?.on_demand || []),
    ]);
    const skillNames = new Set([
      ...(skillLoadResult.tools?.always_on_skill_names || []),
      ...(skillLoadResult.tools?.on_demand_skill_names || []),
    ]);

    const active = new Set();
    const activatedBySkill = [];

    const considerTool = (toolName, scope) => {
      if (scope === 'shared') {
        active.add(toolName);
        return;
      }
      if (Array.isArray(scope) && !scope.includes(agentName)) {
        return;
      }
      if (declared.has(toolName)) {
        active.add(toolName);
        activatedBySkill.push(toolName);
        return;
      }
      // Implicit prefix: <agent>__<skill>__... or <skill>__...
      const parts = toolName.split('__');
      const skillCandidate = parts.length >= 3 && parts[0] === agentName
        ? parts[1]
        : (parts.length >= 2 ? parts[0] : null);
      if (skillCandidate && skillNames.has(skillCandidate)) {
        active.add(toolName);
        activatedBySkill.push(toolName);
      }
    };

    for (const [name, entry] of this._builtins) considerTool(name, entry.scope);
    for (const [name, entry] of this._apiTools) considerTool(name, entry.scope);
    for (const [name, entry] of this._tools) considerTool(name, entry.scope);

    this._activeForRequest = active;
    this._lastActivated = activatedBySkill;

    for (const toolName of activatedBySkill) {
      _appendToolCallLog({
        event: 'activation',
        source: 'on-demand-skill',
        agent: agentName,
        tool: toolName,
      });
    }

    return () => {
      this._activeForRequest = null;
      this._lastActivated = [];
    };
  }

  /**
   * Enable a preset (MCP or API)
   */
  async enablePreset(presetName, apiKey = null) {
    const preset = PRESET_SERVERS[presetName];
    if (!preset) throw new Error(`Unknown preset: ${presetName}. Available: ${Object.keys(PRESET_SERVERS).join(', ')}`);

    // Store API key if provided
    if (apiKey && preset.secretKey) {
      await this.secrets.set(preset.secretKey, apiKey);
    }

    if (preset.type === 'api') {
      // API tools — register directly
      await this._registerAPITools(presetName, preset);

      // Save to config
      if (!this.config.tools) this.config.tools = {};
      if (!this.config.tools.mcp) this.config.tools.mcp = {};
      this.config.tools.mcp[presetName] = { enabled: true, type: 'api' };

      return (preset.tools || []).map(t => ({ name: `${presetName}__${t.name}`, description: t.description }));
    }

    // MCP tools — build server config and connect
    const serverConf = {
      transport: preset.transport,
      command: preset.command,
      args: [...(preset.args || [])],
      url: preset.url,
      env: {},
      enabled: true,
    };

    if (preset.envKey && preset.secretKey) {
      const key = apiKey || await this.secrets.get(preset.secretKey);
      if (key) serverConf.env[preset.envKey] = key;
    }

    const workspace = this.config._dir ? `${this.config._dir}/workspace` : '.';
    serverConf.args = serverConf.args.map(a => {
      if (a === '{workspace}') return workspace;
      if (a === '{connection_string}' && preset.secretKey) return apiKey || '';
      if (a === '{db_path}' && preset.secretKey) return apiKey || '';
      return a;
    });

    if (!this.config.tools) this.config.tools = {};
    if (!this.config.tools.mcp) this.config.tools.mcp = {};
    this.config.tools.mcp[presetName] = serverConf;

    await this._connectServer(presetName, serverConf);
    return this._clients.get(presetName)?.tools || [];
  }

  /**
   * Add a custom MCP server
   */
  async addCustom(name, command, args = []) {
    const serverConf = { transport: 'stdio', command, args, enabled: true };
    if (!this.config.tools) this.config.tools = {};
    if (!this.config.tools.mcp) this.config.tools.mcp = {};
    this.config.tools.mcp[name] = serverConf;
    await this._connectServer(name, serverConf);
    return this._clients.get(name)?.tools || [];
  }

  /**
   * Add a remote SSE MCP server
   */
  async addRemote(name, url, headers = {}) {
    const serverConf = { transport: 'sse', url, headers, enabled: true };
    if (!this.config.tools) this.config.tools = {};
    if (!this.config.tools.mcp) this.config.tools.mcp = {};
    this.config.tools.mcp[name] = serverConf;
    await this._connectServer(name, serverConf);
    return this._clients.get(name)?.tools || [];
  }

  /**
   * List all available tools
   */
  listTools() {
    const result = [];
    for (const [name, handler] of this._builtins) {
      result.push({ name, description: handler.description, source: 'built-in', scope: handler.scope });
    }
    for (const [fullName, { tool, scope }] of this._tools) {
      result.push({ name: fullName, description: tool.description, source: `mcp:${tool.server || fullName.split('__')[0]}`, scope });
    }
    for (const [name, { preset, toolDef, scope }] of this._apiTools) {
      result.push({ name, description: toolDef.description, source: `api:${preset.name}`, scope });
    }
    return result;
  }

  listServers() {
    const result = [];
    for (const [name, client] of this._clients) {
      result.push({ name, connected: client.connected, tools: client.tools.length, transport: client.transport });
    }
    return result;
  }

  async disconnect() {
    for (const [, client] of this._clients) {
      await client.disconnect();
    }
    this._clients.clear();
    this._tools.clear();
    this._apiTools.clear();
  }

  // ─── Private ──────────────────────────────────────────

  async _connectServer(name, serverConf) {
    // Guard: stdio servers require a command; SSE servers require a url
    if (serverConf.transport === 'sse' && !serverConf.url) {
      throw new Error(`SSE server "${name}" has no url configured`);
    }
    if (serverConf.transport !== 'sse' && !serverConf.command) {
      // Try to fill in from preset defaults
      const preset = PRESET_SERVERS[name];
      if (preset?.command) {
        serverConf.command = preset.command;
        serverConf.args = serverConf.args || [...(preset.args || [])];
        serverConf.transport = serverConf.transport || preset.transport;
      } else {
        throw new Error(`Server "${name}" has no command configured`);
      }
    }

    // Substitute placeholders in args (same logic as enablePreset)
    const workspace = this.config._dir ? `${this.config._dir}/workspace` : '.';
    if (serverConf.args) {
      serverConf.args = serverConf.args.map(a => {
        if (a === '{workspace}') return workspace;
        if (a === '{connection_string}') return '';
        if (a === '{db_path}') return '';
        return a;
      });
    }

    const client = new MCPClient({ name, ...serverConf });
    const tools = await client.connect();
    this._clients.set(name, client);
    const scope = _validateScope(PRESET_SCOPE_MAP[name] || 'shared', `mcp ${name}`);
    for (const tool of tools) {
      const fullName = `${name}__${tool.name}`;
      this._tools.set(fullName, { tool, client, scope });
      _appendToolCallLog({
        event: 'registration',
        source: 'mcp',
        tool: fullName,
        scope,
        server: name,
      });
    }
  }

  /**
   * Register a skill-based tool from an agent's skill definition.
   *
   * Slice 3a: 4-arg form is mandatory. The legacy 3-arg shim silently
   * scoped every skill tool to 'shared', which contradicted the
   * per-agent design in CHARLIE_OVERHAUL.md Component 4. Callers must
   * pass the owning agent name explicitly.
   */
  registerSkillTool(agentName, skillName, parsedSkill, toolDef) {
    if (
      typeof agentName !== 'string' || !agentName ||
      typeof skillName !== 'string' || !skillName ||
      typeof parsedSkill !== 'object' || parsedSkill === null ||
      typeof toolDef !== 'object' || toolDef === null
    ) {
      throw new Error(
        '[ToolRegistry] registerSkillTool requires the 4-arg form ' +
        '(agentName, skillName, parsedSkill, toolDef). 3-arg call sites ' +
        'were removed in Slice 3a — pass the owning agent name explicitly.'
      );
    }

    if (!toolDef.name || !parsedSkill.baseUrl) {
      return;
    }

    const fullName = `${agentName}__${skillName}__${toolDef.name}`;
    const scope = _validateScope([agentName], `skill tool ${fullName}`);

    const preset = {
      name: `skill:${skillName}`,
      type: 'api',
      baseUrl: parsedSkill.baseUrl,
      headers: parsedSkill.headers || {},
      secretKey: parsedSkill.secretKey || null
    };

    const entry = {
      preset,
      toolDef,
      skill: parsedSkill,
      scope,
    };

    this._apiTools.set(fullName, entry);
    _appendToolCallLog({
      event: 'registration',
      source: 'skill',
      agent: agentName,
      tool: fullName,
      scope,
      skill: skillName,
    });
    log.debug(`[ToolRegistry] Registered skill tool: ${fullName} (scope: ${JSON.stringify(scope)})`);
  }

  async _registerAPITools(presetName, preset) {
    const scope = _validateScope(
      PRESET_SCOPE_MAP[presetName] || 'shared',
      `preset ${presetName}`
    );
    for (const toolDef of (preset.tools || [])) {
      const fullName = `${presetName}__${toolDef.name}`;
      this._apiTools.set(fullName, { preset, toolDef, scope });
      _appendToolCallLog({
        event: 'registration',
        source: 'preset',
        tool: fullName,
        scope,
        preset: presetName,
      });
    }
  }

  async _executeAPITool(preset, toolDef, args) {
    let apiKey = null;
    if (preset.secretKey) {
      // Issue a scoped envelope for skill/API tool execution (short TTL)
      if (this.secrets.issueEnvelope && preset.name?.startsWith('skill:')) {
        try {
          const skillName = preset.name.slice(6); // strip 'skill:' prefix
          const envelope = await this.secrets.issueEnvelope(
            preset.secretKey,
            `skill:${skillName}:${toolDef.name}`,
            null,  // inherit default scopes from SERVICE_MAP
            300    // 5-minute TTL for skill executions
          );
          if (envelope) {
            apiKey = envelope.getValue();
            log.debug(`[AGEX] Skill "${skillName}" using envelope (TTL ${envelope.ttlSeconds}s, source=${envelope.source})`);
          }
        } catch (err) {
          log.debug(`[AGEX] Envelope failed for skill tool: ${err.message} — falling back to direct get`);
        }
      }
      // Fallback: direct credential fetch (existing behaviour)
      if (!apiKey) {
        apiKey = await this.secrets.get(preset.secretKey);
      }
    }
    const toolName = toolDef.name;

    try {
      // ── Google Places ───────────────────────────────────
      if (preset.name === 'Google Places') {
        if (toolName === 'search_places') {
          const res = await fetch(`https://places.googleapis.com/v1/places:searchText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.currentOpeningHours,places.id,places.types,places.priceLevel' },
            body: JSON.stringify({ textQuery: args.query, maxResultCount: args.maxResults || 5 }),
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) return `Google Places error: ${res.status}`;
          const data = await res.json();
          return JSON.stringify((data.places || []).map(p => ({
            name: p.displayName?.text, address: p.formattedAddress, rating: p.rating,
            reviews: p.userRatingCount, open: p.currentOpeningHours?.openNow, placeId: p.id, types: p.types?.slice(0, 3),
          })), null, 2);
        }
        if (toolName === 'place_details') {
          const res = await fetch(`https://places.googleapis.com/v1/places/${args.placeId}`, {
            headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'displayName,formattedAddress,rating,userRatingCount,currentOpeningHours,nationalPhoneNumber,websiteUri,reviews,priceLevel,types' },
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) return `Google Places error: ${res.status}`;
          return JSON.stringify(await res.json(), null, 2).slice(0, 4000);
        }
        if (toolName === 'nearby_places') {
          const res = await fetch(`https://places.googleapis.com/v1/places:searchNearby`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.id,places.types' },
            body: JSON.stringify({ includedTypes: [args.type], locationRestriction: { circle: { center: { latitude: args.latitude, longitude: args.longitude }, radius: args.radius || 1500 } }, maxResultCount: 10 }),
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) return `Google Places error: ${res.status}`;
          const data = await res.json();
          return JSON.stringify((data.places || []).map(p => ({ name: p.displayName?.text, address: p.formattedAddress, rating: p.rating, placeId: p.id })), null, 2);
        }
      }

      // ── Weather ─────────────────────────────────────────
      if (preset.name === 'Weather') {
        const units = args.units || 'metric';
        if (toolName === 'get_weather') {
          const q = args.city ? `q=${encodeURIComponent(args.city)}` : `lat=${args.lat}&lon=${args.lon}`;
          const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?${q}&units=${units}&appid=${apiKey}`, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `Weather API error: ${res.status}`;
          const d = await res.json();
          return `${d.name}: ${d.main.temp}°${units === 'metric' ? 'C' : 'F'}, ${d.weather[0].description}. Feels like ${d.main.feels_like}°. Humidity ${d.main.humidity}%. Wind ${d.wind.speed}${units === 'metric' ? 'm/s' : 'mph'}.`;
        }
        if (toolName === 'get_forecast') {
          const res = await fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(args.city)}&units=${units}&cnt=8&appid=${apiKey}`, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `Weather API error: ${res.status}`;
          const d = await res.json();
          return (d.list || []).map(f => `${f.dt_txt}: ${f.main.temp}°, ${f.weather[0].description}`).join('\n');
        }
      }

      // ── News ────────────────────────────────────────────
      if (preset.name === 'News') {
        if (toolName === 'search_news') {
          const params = new URLSearchParams({ q: args.query, sortBy: args.sortBy || 'publishedAt', pageSize: '5', apiKey });
          if (args.from) params.set('from', args.from);
          if (args.to) params.set('to', args.to);
          if (args.language) params.set('language', args.language);
          const res = await fetch(`https://newsapi.org/v2/everything?${params}`, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `News API error: ${res.status}`;
          const d = await res.json();
          return (d.articles || []).map(a => `${a.title} — ${a.source.name} (${a.publishedAt?.slice(0, 10)})\n${a.description || ''}\n${a.url}`).join('\n\n');
        }
        if (toolName === 'top_headlines') {
          const params = new URLSearchParams({ pageSize: '5', apiKey });
          if (args.country) params.set('country', args.country);
          if (args.category) params.set('category', args.category);
          const res = await fetch(`https://newsapi.org/v2/top-headlines?${params}`, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `News API error: ${res.status}`;
          const d = await res.json();
          return (d.articles || []).map(a => `${a.title} — ${a.source.name}\n${a.description || ''}`).join('\n\n');
        }
      }

      // ── Google Maps ─────────────────────────────────────
      if (preset.name === 'Google Maps') {
        if (toolName === 'get_directions') {
          const params = new URLSearchParams({ origin: args.origin, destination: args.destination, mode: args.mode || 'driving', key: apiKey });
          const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `Maps API error: ${res.status}`;
          const d = await res.json();
          const route = d.routes?.[0];
          if (!route) return 'No route found.';
          const leg = route.legs[0];
          const steps = leg.steps.map((s, i) => `${i + 1}. ${s.html_instructions?.replace(/<[^>]+>/g, '')} (${s.distance.text})`).join('\n');
          return `${leg.distance.text} — ${leg.duration.text}\n\n${steps}`;
        }
        if (toolName === 'geocode') {
          const params = args.address
            ? new URLSearchParams({ address: args.address, key: apiKey })
            : new URLSearchParams({ latlng: `${args.lat},${args.lng}`, key: apiKey });
          const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `Geocode error: ${res.status}`;
          const d = await res.json();
          const r = d.results?.[0];
          if (!r) return 'No results.';
          return `${r.formatted_address}\nLat: ${r.geometry.location.lat}, Lng: ${r.geometry.location.lng}`;
        }
      }

      // ── Currency ────────────────────────────────────────
      if (preset.name === 'Currency Exchange') {
        const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${args.from.toUpperCase()}`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return `Exchange rate error: ${res.status}`;
        const d = await res.json();
        const rate = d.rates[args.to.toUpperCase()];
        if (!rate) return `Unknown currency: ${args.to}`;
        const amount = args.amount || 1;
        return `${amount} ${args.from.toUpperCase()} = ${(amount * rate).toFixed(2)} ${args.to.toUpperCase()} (rate: ${rate})`;
      }

      // ── YouTube ─────────────────────────────────────────
      if (preset.name === 'YouTube') {
        if (toolName === 'search_videos') {
          const params = new URLSearchParams({ part: 'snippet', type: 'video', q: args.query, maxResults: String(args.maxResults || 5), order: args.order || 'relevance', key: apiKey });
          const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `YouTube error: ${res.status}`;
          const d = await res.json();
          return (d.items || []).map(v => `${v.snippet.title} — ${v.snippet.channelTitle}\nhttps://youtube.com/watch?v=${v.id.videoId}`).join('\n\n');
        }
        if (toolName === 'video_details') {
          const params = new URLSearchParams({ part: 'snippet,statistics', id: args.videoId, key: apiKey });
          const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `YouTube error: ${res.status}`;
          const d = await res.json();
          const v = d.items?.[0];
          if (!v) return 'Video not found.';
          return `${v.snippet.title}\n${v.snippet.channelTitle}\nViews: ${v.statistics.viewCount} | Likes: ${v.statistics.likeCount}\n${v.snippet.description?.slice(0, 500)}`;
        }
      }

      // ── Stripe ──────────────────────────────────────────
      if (preset.name === 'Stripe') {
        const headers = { 'Authorization': `Bearer ${apiKey}` };
        if (toolName === 'list_payments') {
          const params = new URLSearchParams({ limit: String(args.limit || 10) });
          if (args.status) params.set('status', args.status);
          const res = await fetch(`https://api.stripe.com/v1/charges?${params}`, { headers, signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `Stripe error: ${res.status}`;
          const d = await res.json();
          return (d.data || []).map(c => `${c.status} — ${(c.amount / 100).toFixed(2)} ${c.currency.toUpperCase()} — ${c.description || 'no description'} (${new Date(c.created * 1000).toLocaleDateString()})`).join('\n');
        }
        if (toolName === 'list_customers') {
          const params = new URLSearchParams({ limit: String(args.limit || 10) });
          if (args.email) params.set('email', args.email);
          const res = await fetch(`https://api.stripe.com/v1/customers?${params}`, { headers, signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `Stripe error: ${res.status}`;
          const d = await res.json();
          return (d.data || []).map(c => `${c.name || 'unnamed'} — ${c.email || 'no email'} (balance: ${(c.balance / 100).toFixed(2)})`).join('\n');
        }
        if (toolName === 'list_invoices') {
          const params = new URLSearchParams({ limit: String(args.limit || 10) });
          if (args.status) params.set('status', args.status);
          const res = await fetch(`https://api.stripe.com/v1/invoices?${params}`, { headers, signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `Stripe error: ${res.status}`;
          const d = await res.json();
          return (d.data || []).map(i => `${i.status} — ${((i.amount_due || 0) / 100).toFixed(2)} ${(i.currency || '').toUpperCase()} — ${i.customer_email || 'no email'}`).join('\n');
        }
      }

      // ── GoHighLevel ─────────────────────────────────────
      if (preset.name === 'GoHighLevel') {
        const headers = { 'Authorization': `Bearer ${apiKey}`, 'Version': '2021-07-28', 'Content-Type': 'application/json' };
        const base = 'https://services.leadconnectorhq.com';
        if (toolName === 'search_contacts') {
          const res = await fetch(`${base}/contacts/search`, { method: 'POST', headers, body: JSON.stringify({ query: args.query, limit: args.limit || 20 }), signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `GHL error: ${res.status}`;
          const d = await res.json();
          return JSON.stringify((d.contacts || []).map(c => ({ id: c.id, name: `${c.firstName || ''} ${c.lastName || ''}`.trim(), email: c.email, phone: c.phone, tags: c.tags })), null, 2);
        }
        if (toolName === 'get_contact') {
          const res = await fetch(`${base}/contacts/${args.contactId}`, { headers, signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `GHL error: ${res.status}`;
          return JSON.stringify(await res.json(), null, 2).slice(0, 4000);
        }
        if (toolName === 'list_pipelines') {
          const res = await fetch(`${base}/opportunities/pipelines`, { headers, signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `GHL error: ${res.status}`;
          return JSON.stringify(await res.json(), null, 2).slice(0, 4000);
        }
        if (toolName === 'list_opportunities') {
          const params = new URLSearchParams({ pipelineId: args.pipelineId, limit: String(args.limit || 20) });
          if (args.stageId) params.set('stageId', args.stageId);
          const res = await fetch(`${base}/opportunities/search?${params}`, { headers, signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `GHL error: ${res.status}`;
          return JSON.stringify(await res.json(), null, 2).slice(0, 4000);
        }
      }

      // ── Google Sheets ───────────────────────────────────
      if (preset.name === 'Google Sheets') {
        const headers = { 'Authorization': `Bearer ${apiKey}` };
        if (toolName === 'read_sheet') {
          const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheetId}/values/${encodeURIComponent(args.range)}`, { headers, signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `Sheets error: ${res.status}`;
          const d = await res.json();
          return (d.values || []).map(row => row.join('\t')).join('\n');
        }
        if (toolName === 'write_sheet') {
          let values;
          try { values = JSON.parse(args.values); } catch { return 'Error: values must be valid JSON array of arrays'; }
          const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${args.spreadsheetId}/values/${encodeURIComponent(args.range)}?valueInputOption=USER_ENTERED`, {
            method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ values }), signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) return `Sheets error: ${res.status}`;
          const d = await res.json();
          return `Updated ${d.updatedCells} cells in ${d.updatedRange}`;
        }
      }

      // ── Google Calendar ─────────────────────────────────
      if (preset.name === 'Google Calendar') {
        const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
        if (toolName === 'list_events') {
          const params = new URLSearchParams({
            maxResults: String(args.maxResults || 10),
            timeMin: args.timeMin || new Date().toISOString(),
            singleEvents: 'true', orderBy: 'startTime',
          });
          if (args.timeMax) params.set('timeMax', args.timeMax);
          const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers, signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `Calendar error: ${res.status}`;
          const d = await res.json();
          return (d.items || []).map(e => `${e.summary || 'Untitled'} — ${e.start?.dateTime || e.start?.date}${e.location ? ' @ ' + e.location : ''}`).join('\n');
        }
        if (toolName === 'create_event') {
          const event = { summary: args.summary, start: { dateTime: args.start }, end: { dateTime: args.end } };
          if (args.description) event.description = args.description;
          if (args.location) event.location = args.location;
          if (args.attendees) event.attendees = args.attendees.split(',').map(e => ({ email: e.trim() }));
          const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST', headers, body: JSON.stringify(event), signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) return `Calendar error: ${res.status}`;
          const d = await res.json();
          return `Created: ${d.summary} at ${d.start.dateTime}\nLink: ${d.htmlLink}`;
        }
      }

      // ── n8n Webhooks ────────────────────────────────────
      if (preset.name === 'n8n Webhooks') {
        const baseUrl = (apiKey || '').replace(/\/$/, '');
        const res = await fetch(`${baseUrl}${args.webhookPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: args.data || '{}',
          signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        return res.ok ? `Webhook triggered. Response: ${text.slice(0, 2000)}` : `Webhook error ${res.status}: ${text.slice(0, 500)}`;
      }

      // ── Generic Skill HTTP Executor ─────────────────
      if (preset.name?.startsWith('skill:')) {
        const endpoint = toolDef.endpoint || toolDef.path || '';
        const method = toolDef.method || 'GET';
        let url = `${preset.baseUrl}${endpoint}`;

        // Resolve {{secrets.key}} patterns in endpoint URL (e.g. locationId query params)
        const urlSecretMatches = url.matchAll(/\{\{secrets\.([^}]+)\}\}/g);
        for (const match of urlSecretMatches) {
          const val = await this.secrets.get(match[1]);
          url = url.replace(match[0], (val || '').trim());
        }

        // Resolve {{param}} placeholders from args (path- or query-string position).
        // Consumed args are tracked so they aren't re-appended as a query string below.
        const consumedArgs = new Set();
        for (const [k, v] of Object.entries(args || {})) {
          const needle = `{{${k}}}`;
          if (url.includes(needle)) {
            url = url.split(needle).join(encodeURIComponent(v));
            consumedArgs.add(k);
          }
        }

        const headers = {};

        // Resolve all headers — replace {{secrets.key}} with actual secret values
        // .trim() prevents stray newlines/whitespace from breaking auth headers
        for (const [k, v] of Object.entries(preset.headers || {})) {
          if (v && v.includes('{{secrets.')) {
            const secretKey = v.match(/\{\{secrets\.([^}]+)\}\}/)?.[1];
            if (secretKey) {
              const val = await this.secrets.get(secretKey);
              headers[k] = v.replace(`{{secrets.${secretKey}}}`, (val || '').trim());
            } else {
              headers[k] = v;
            }
          } else {
            headers[k] = v;
          }
        }

        // Build query params or body
        let fetchUrl = url;
        let body = undefined;
        if (method === 'GET' && args && Object.keys(args).length > 0) {
          // Strip params already present in the URL to avoid duplicates (e.g. limit)
          const existingUrl = new URL(url, 'http://placeholder');
          const extra = {};
          for (const [k, v] of Object.entries(args)) {
            if (consumedArgs.has(k)) continue;
            if (!existingUrl.searchParams.has(k)) extra[k] = v;
          }
          if (Object.keys(extra).length > 0) {
            const params = new URLSearchParams(extra);
            const sep = url.includes('?') ? '&' : '?';
            fetchUrl = `${url}${sep}${params}`;
          }
        } else if (method !== 'GET' && args) {
          body = JSON.stringify(args);
          headers['Content-Type'] = 'application/json';
        }

        const res = await fetch(fetchUrl, { method, headers, body, signal: AbortSignal.timeout(15000) });
        const text = await res.text();
        if (!res.ok) return `${preset.name} error ${res.status}: ${text.slice(0, 500)}`;
        try {
          const json = JSON.parse(text);
          // Array-heavy responses (e.g. contacts, invoices): compact JSON to fit more records
          const topArrayKey = Object.keys(json).find(k => Array.isArray(json[k]));
          if (topArrayKey) return JSON.stringify(json).slice(0, 8000);
          return JSON.stringify(json, null, 2).slice(0, 8000);
        } catch { return text.slice(0, 8000); }
      }
      return `API tool ${toolName} not implemented for ${preset.name}`;
    } catch (err) {
      return `API error (${preset.name}/${toolName}): ${err.message}`;
    }
  }

  /**
   * Returns true if a tool with this name is registered anywhere
   * (built-in, MCP, or skill/API).
   */
  has(name) {
    return this._builtins.has(name) || this._apiTools.has(name) || this._tools.has(name);
  }

  /**
   * Returns the registered built-in entry for inspection (e.g. when
   * index.js wants to keep description/inputSchema while overriding
   * the fn body). Returns undefined if the name is not a built-in.
   */
  getBuiltin(name) {
    return this._builtins.get(name);
  }

  /**
   * Public registration API for built-in tools.
   *
   * Replaces the Slice-2-era pattern of mutating ToolRegistry._builtins
   * from index.js. Every entry must carry an explicit scope ('shared' or
   * a non-empty array of agent names) — the shared__ rule lives in
   * CHARLIE_OVERHAUL.md Component 4.
   */
  registerBuiltin(name, definition) {
    if (typeof name !== 'string' || !name) {
      throw new Error('[ToolRegistry] registerBuiltin: name must be a non-empty string');
    }
    if (!definition || typeof definition !== 'object') {
      throw new Error(`[ToolRegistry] registerBuiltin(${name}): definition is required`);
    }
    if (typeof definition.fn !== 'function') {
      throw new Error(`[ToolRegistry] registerBuiltin(${name}): definition.fn must be a function`);
    }
    const scope = _validateScope(definition.scope, `builtin ${name}`);
    const entry = {
      description: definition.description || name,
      inputSchema: definition.inputSchema || { type: 'object', properties: {} },
      fn: definition.fn,
      scope,
    };
    if (definition.longRunning) entry.longRunning = true;
    this._builtins.set(name, entry);
    _appendToolCallLog({
      event: 'registration',
      source: 'builtin',
      tool: name,
      scope,
    });
  }

  _registerBuiltins() {
    // Current time
    this.registerBuiltin('get_current_time', {
      scope: 'shared',
      description: 'Get the current date and time',
      inputSchema: { type: 'object', properties: {
        timezone: { type: 'string', description: 'IANA timezone (e.g. Europe/London). Default: UTC' }
      }},
      fn: async ({ timezone }) => {
        const opts = { dateStyle: 'full', timeStyle: 'long' };
        if (timezone) opts.timeZone = timezone;
        return new Date().toLocaleString('en-GB', opts);
      }
    });

    // Calculator
    this.registerBuiltin('calculate', {
      scope: 'shared',
      description: 'Evaluate a mathematical expression',
      inputSchema: { type: 'object', properties: {
        expression: { type: 'string', description: 'Math expression (e.g. "2 * (3 + 4)")' }
      }, required: ['expression'] },
      fn: async ({ expression }) => {
        // Safe math eval (no eval())
        const sanitised = expression.replace(/[^0-9+\-*/().%\s]/g, '');
        try {
          const result = Function(`"use strict"; return (${sanitised})`)();
          return String(result);
        } catch {
          return `Error: invalid expression "${expression}"`;
        }
      }
    });

    // HTTP fetch (simple)
    this.registerBuiltin('web_fetch', {
      scope: 'shared',
      description: 'Fetch the text content of a URL',
      inputSchema: { type: 'object', properties: {
        url: { type: 'string', description: 'URL to fetch' }
      }, required: ['url'] },
      fn: async ({ url }) => {
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'QuantumClaw/1.0' },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
          const text = await res.text();
          // Truncate to ~4000 chars to stay within context
          return text.slice(0, 4000);
        } catch (err) {
          return `Fetch error: ${err.message}`;
        }
      }
    });

    // Knowledge graph query (uses the local graph)
    this.registerBuiltin('search_knowledge', {
      scope: 'shared',
      description: 'Search the knowledge graph for entities, relationships, and stored memories',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string', description: 'Natural language search query' }
      }, required: ['query'] },
      fn: async ({ query }) => {
        // This gets wired up to the memory manager in the agent
        return `[Knowledge search for: ${query}] — wire this to memory.graphQuery()`;
      }
    });
  }

  _formatTool(name, description, inputSchema, format) {
    if (format === 'anthropic') {
      return {
        name,
        description: description || name,
        input_schema: inputSchema || { type: 'object', properties: {} },
      };
    }

    // OpenAI format
    return {
      type: 'function',
      function: {
        name,
        description: description || name,
        parameters: inputSchema || { type: 'object', properties: {} },
      }
    };
  }
}
