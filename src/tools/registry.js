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

  filesystem: {
    name: 'Filesystem',
    type: 'mcp',
    description: 'Read, write, search files on your device',
    transport: 'stdio',
    npm: '@modelcontextprotocol/server-filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '{workspace}'],
    envKey: null,
    secretKey: null,
    setup: 'Gives your agent access to read/write files in your workspace.',
    requiresKey: false,
  },

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
    this._tools = new Map();     // toolName -> { tool, client }
    this._apiTools = new Map();  // toolName -> { preset, toolDef }
    this._builtins = new Map();  // toolName -> handler function
    this._broadcastFn = null;    // dashboard broadcast for canvas tools
    this._trustKernel = null;    // set via setTrustKernel()
  }

  /** Wire dashboard broadcast for render_canvas tool */
  setBroadcast(fn) { this._broadcastFn = fn; }

  /** Wire trust kernel for scope enforcement */
  setTrustKernel(tk) { this._trustKernel = tk; }

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
   */
  list() {
    const result = [];
    for (const [name, handler] of this._builtins) {
      result.push({ name, description: handler.description, source: 'built-in' });
    }
    for (const [name] of this._tools) {
      result.push({ name, description: '', source: 'mcp' });
    }
    for (const [name, { toolDef }] of this._apiTools) {
      result.push({ name, description: toolDef?.description || '', source: 'api' });
    }
    return result;
  }

  getToolDefinitions(format = 'anthropic') {
    const tools = [];

    // Built-in tools
    for (const [name, handler] of this._builtins) {
      tools.push(this._formatTool(name, handler.description, handler.inputSchema, format));
    }

    // MCP tools
    for (const [name, { tool }] of this._tools) {
      const fullName = `${tool.server}__${tool.name}`;
      tools.push(this._formatTool(fullName, tool.description, tool.inputSchema, format));
    }

    // API tools
    for (const [name, { toolDef }] of this._apiTools) {
      tools.push(this._formatTool(name, toolDef.description, toolDef.inputSchema, format));
    }

    return tools;
  }

  /**
   * Execute a tool call from the LLM
   */
  async executeTool(toolName, args = {}) {
    // Trust Kernel scope enforcement
    if (this._trustKernel) {
      const check = this._trustKernel.check({
        type: 'tool_call',
        description: `${toolName} ${JSON.stringify(args).slice(0, 200)}`,
      });
      if (!check.allowed) {
        return `⛔ ${check.reason}`;
      }
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
      result.push({ name, description: handler.description, source: 'built-in' });
    }
    for (const [, { tool }] of this._tools) {
      result.push({ name: `${tool.server}__${tool.name}`, description: tool.description, source: `mcp:${tool.server}` });
    }
    for (const [name, { preset, toolDef }] of this._apiTools) {
      result.push({ name, description: toolDef.description, source: `api:${preset.name}` });
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
    // Substitute placeholders in server args
    const workspace = this.config._dir ? `${this.config._dir}/workspace` : '.';
    if (serverConf.args && Array.isArray(serverConf.args)) {
      serverConf = {
        ...serverConf,
        args: serverConf.args.map(a => {
          if (a === '{workspace}') return workspace;
          if (a === '{connection_string}') return this.config.tools?.postgres?.connectionString || a;
          if (a === '{db_path}') return this.config.tools?.sqlite?.dbPath || `${workspace}/data.db`;
          return a;
        }),
      };
    }
    const client = new MCPClient({ name, ...serverConf });
    const tools = await client.connect();
    this._clients.set(name, client);
    for (const tool of tools) {
      this._tools.set(`${name}__${tool.name}`, { tool, client });
    }
  }

  async _registerAPITools(presetName, preset) {
    for (const toolDef of (preset.tools || [])) {
      const fullName = `${presetName}__${toolDef.name}`;
      this._apiTools.set(fullName, { preset, toolDef });
    }
  }

  async _executeAPITool(preset, toolDef, args) {
    const apiKey = preset.secretKey ? await this.secrets.get(preset.secretKey) : null;
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

      return `API tool ${toolName} not implemented for ${preset.name}`;
    } catch (err) {
      return `API error (${preset.name}/${toolName}): ${err.message}`;
    }
  }

  _registerBuiltins() {
    // Current time
    this._builtins.set('get_current_time', {
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
    this._builtins.set('calculate', {
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
    this._builtins.set('web_fetch', {
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
    this._builtins.set('search_knowledge', {
      description: 'Search the knowledge graph for entities, relationships, and stored memories',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string', description: 'Natural language search query' }
      }, required: ['query'] },
      fn: async ({ query }) => {
        return `[Knowledge search for: ${query}] — wire this to memory.graphQuery()`;
      }
    });

    // Shell command execution (requires approval via Trust Kernel)
    this._builtins.set('shell_exec', {
      description: 'Execute a shell command. Returns stdout/stderr. Use for system tasks, package management, file operations, git commands, etc. Commands are subject to approval.',
      inputSchema: { type: 'object', properties: {
        command: { type: 'string', description: 'Shell command to execute (e.g. "ls -la", "git status", "npm install")' },
        cwd: { type: 'string', description: 'Working directory (optional, defaults to home)' },
        timeout: { type: 'number', description: 'Timeout in seconds (default: 30, max: 120)' },
      }, required: ['command'] },
      fn: async ({ command, cwd, timeout }) => {
        const { execSync } = await import('child_process');
        const timeoutMs = Math.min((timeout || 30), 120) * 1000;
        const allowList = this.config.tools?.shell?.allowList || [];

        // Check allowlist if configured
        if (allowList.length > 0) {
          const cmd = command.trim().split(/\s+/)[0];
          if (!allowList.includes(cmd)) {
            return `Command "${cmd}" not in shell allowlist. Allowed: ${allowList.join(', ')}`;
          }
        }

        try {
          const result = execSync(command, {
            encoding: 'utf-8',
            timeout: timeoutMs,
            cwd: cwd || process.env.HOME,
            maxBuffer: 1024 * 512, // 512KB
          });
          return result.slice(0, 10000) || '(no output)';
        } catch (err) {
          const stderr = err.stderr?.slice(0, 5000) || '';
          const stdout = err.stdout?.slice(0, 5000) || '';
          return `Exit code ${err.status || 1}\n${stderr}\n${stdout}`.trim();
        }
      }
    });

    // Read file
    this._builtins.set('read_file', {
      description: 'Read the contents of a file from the local filesystem.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Absolute or relative file path' },
        encoding: { type: 'string', description: 'Encoding (default: utf-8). Use "base64" for binary files.' },
      }, required: ['path'] },
      fn: async ({ path, encoding }) => {
        const { readFileSync, statSync } = await import('fs');
        const { resolve } = await import('path');
        const fullPath = resolve(path);
        try {
          const stat = statSync(fullPath);
          if (stat.size > 1024 * 1024) return `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max 1MB.`;
          return readFileSync(fullPath, encoding || 'utf-8');
        } catch (err) {
          return `Error reading ${fullPath}: ${err.message}`;
        }
      }
    });

    // Write file
    this._builtins.set('write_file', {
      description: 'Write content to a file on the local filesystem. Creates directories if needed.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'File path to write to' },
        content: { type: 'string', description: 'Content to write' },
        append: { type: 'boolean', description: 'Append instead of overwrite (default: false)' },
      }, required: ['path', 'content'] },
      fn: async ({ path, content, append }) => {
        const { writeFileSync, appendFileSync, mkdirSync } = await import('fs');
        const { resolve, dirname } = await import('path');
        const fullPath = resolve(path);
        try {
          mkdirSync(dirname(fullPath), { recursive: true });
          if (append) {
            appendFileSync(fullPath, content);
          } else {
            writeFileSync(fullPath, content);
          }
          return `Written ${content.length} chars to ${fullPath}`;
        } catch (err) {
          return `Error writing ${fullPath}: ${err.message}`;
        }
      }
    });

    // List directory
    this._builtins.set('list_directory', {
      description: 'List files and directories at a given path.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Directory path (default: home)' },
      }},
      fn: async ({ path }) => {
        const { readdirSync, statSync } = await import('fs');
        const { resolve, join } = await import('path');
        const dir = resolve(path || process.env.HOME);
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          return entries.map(e => {
            const prefix = e.isDirectory() ? '📁 ' : '📄 ';
            try {
              const stat = statSync(join(dir, e.name));
              const size = e.isDirectory() ? '' : ` (${(stat.size / 1024).toFixed(1)}KB)`;
              return `${prefix}${e.name}${size}`;
            } catch { return `${prefix}${e.name}`; }
          }).join('\n') || '(empty directory)';
        } catch (err) {
          return `Error listing ${dir}: ${err.message}`;
        }
      }
    });

    // Render content to the Live Canvas in the dashboard
    this._builtins.set('render_canvas', {
      description: 'Display content in the Live Canvas panel. Use for HTML pages, charts, diagrams, markdown docs, SVGs, or any visual artifact the user would benefit from seeing rendered.',
      inputSchema: { type: 'object', properties: {
        format: { type: 'string', enum: ['html', 'markdown', 'mermaid', 'svg', 'image'], description: 'Content format' },
        title: { type: 'string', description: 'Short title for the artifact tab' },
        content: { type: 'string', description: 'The content to render. For html: full HTML with inline CSS/JS. For mermaid: mermaid diagram code. For svg: SVG markup. For image: URL.' },
      }, required: ['format', 'content'] },
      fn: async ({ format, title, content }) => {
        // This broadcasts via the dashboard server's WebSocket
        if (this._broadcastFn) {
          this._broadcastFn({
            type: 'canvas_render',
            format: format || 'html',
            title: title || 'Artifact',
            content,
            id: `canvas-${Date.now()}`,
          });
          return `Rendered "${title || 'artifact'}" (${format}) in Live Canvas.`;
        }
        return `Canvas not available — dashboard not connected.`;
      }
    });

    // ── web_search — Brave Search API ────────────────────────
    this._builtins.set('web_search', {
      description: 'Search the web using Brave Search API. Returns top results with titles, URLs, and descriptions.',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Number of results (1-10, default 5)' },
      }, required: ['query'] },
      fn: async ({ query, count = 5 }) => {
        const braveKey = await this.secrets?.get?.('brave_api_key')
          || process.env.BRAVE_API_KEY;
        if (!braveKey) return 'web_search requires BRAVE_API_KEY. Set it via: qclaw secret set brave_api_key YOUR_KEY';
        try {
          const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 10)}`;
          const res = await fetch(url, { headers: { 'X-Subscription-Token': braveKey, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `Brave Search error: ${res.status} ${res.statusText}`;
          const data = await res.json();
          const results = (data.web?.results || []).slice(0, count);
          if (!results.length) return `No results for "${query}"`;
          return results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description || ''}`).join('\n\n');
        } catch (err) { return `Search failed: ${err.message}`; }
      }
    });

    // ── manage_process — background exec management ──────────
    this._builtins.set('manage_process', {
      description: 'Manage background shell processes. Start a command in the background, then poll/log/kill it later.',
      inputSchema: { type: 'object', properties: {
        action: { type: 'string', enum: ['start', 'list', 'poll', 'log', 'kill'], description: 'Action to perform' },
        command: { type: 'string', description: 'Shell command (for start action)' },
        pid: { type: 'string', description: 'Process ID (for poll/log/kill)' },
      }, required: ['action'] },
      fn: async ({ action, command, pid }) => {
        if (!this._bgProcesses) this._bgProcesses = new Map();
        const { spawn } = await import('child_process');

        switch (action) {
          case 'start': {
            if (!command) return 'command required for start';
            const proc = spawn('sh', ['-c', command], { cwd: process.env.HOME, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
            const id = `bg-${proc.pid}`;
            const entry = { pid: proc.pid, command, stdout: '', stderr: '', exitCode: null, startedAt: new Date().toISOString() };
            proc.stdout.on('data', d => { entry.stdout += d.toString(); if (entry.stdout.length > 512000) entry.stdout = entry.stdout.slice(-256000); });
            proc.stderr.on('data', d => { entry.stderr += d.toString(); if (entry.stderr.length > 512000) entry.stderr = entry.stderr.slice(-256000); });
            proc.on('exit', code => { entry.exitCode = code; });
            proc.unref();
            this._bgProcesses.set(id, { proc, entry });
            return `Started background process ${id} (PID ${proc.pid}): ${command}`;
          }
          case 'list': {
            if (!this._bgProcesses.size) return 'No background processes';
            return [...this._bgProcesses.entries()].map(([id, { entry }]) =>
              `${id}: ${entry.command.slice(0, 60)} — ${entry.exitCode === null ? 'running' : `exited (${entry.exitCode})`}`
            ).join('\n');
          }
          case 'poll': {
            const p = this._bgProcesses.get(pid);
            if (!p) return `Unknown process: ${pid}`;
            const e = p.entry;
            const last100 = e.stdout.split('\n').slice(-20).join('\n');
            return `PID ${e.pid} — ${e.exitCode === null ? 'RUNNING' : `EXITED (${e.exitCode})`}\n\nLast output:\n${last100}${e.stderr ? '\n\nStderr:\n' + e.stderr.split('\n').slice(-5).join('\n') : ''}`;
          }
          case 'log': {
            const p = this._bgProcesses.get(pid);
            if (!p) return `Unknown process: ${pid}`;
            return p.entry.stdout || '(no output yet)';
          }
          case 'kill': {
            const p = this._bgProcesses.get(pid);
            if (!p) return `Unknown process: ${pid}`;
            try { process.kill(p.proc.pid, 'SIGTERM'); } catch { /* already dead */ }
            this._bgProcesses.delete(pid);
            return `Killed ${pid}`;
          }
          default: return `Unknown action: ${action}`;
        }
      }
    });

    // ── send_message — cross-channel message sending ─────────
    this._builtins.set('send_message', {
      description: 'Send a message to a specific user on a specific channel, or broadcast to all channels.',
      inputSchema: { type: 'object', properties: {
        channel: { type: 'string', description: 'Channel name: telegram, discord, whatsapp, slack, email, or "all" for broadcast' },
        target: { type: 'string', description: 'User ID or chat ID on the channel' },
        message: { type: 'string', description: 'Message text to send' },
      }, required: ['message'] },
      fn: async ({ channel, target, message }) => {
        if (this._broadcastFn && (!channel || channel === 'all')) {
          this._broadcastFn({ type: 'proactive_message', content: message, agent: 'tool', source: 'send_message' });
          return `Broadcast sent: "${message.slice(0, 60)}..."`;
        }
        return `Message queued for ${channel || 'all'}:${target || 'broadcast'}: "${message.slice(0, 60)}..."`;
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
