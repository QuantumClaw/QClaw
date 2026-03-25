/**
 * QuantumClaw — Skill Parser
 *
 * Converts markdown skill files into executable HTTP tools.
 *
 * Skill format (markdown):
 *
 * ```markdown
 * # Stripe Billing
 *
 * ## Auth
 * Base URL: https://api.stripe.com/v1
 * Header: Authorization: Bearer {{secrets.stripe_api_key}}
 *
 * ## Endpoints
 * GET /customers - List customers
 * POST /customers - Create customer
 * GET /invoices - List invoices
 * POST /invoices - Create invoice
 *
 * ## Permissions
 * - http: [api.stripe.com]
 * - shell: none
 * - file: none
 *
 * ## Usage Notes
 * - Never expose API keys
 * - Confirm amounts before creating charges
 * ```
 *
 * This parser extracts:
 *   - Base URL
 *   - Headers (with secret interpolation)
 *   - Endpoints → converted to tool definitions
 */

/**
 * Parse a skill markdown file into an executable tool config
 * @param {string} name - Skill name (from filename)
 * @param {string} content - Markdown content
 * @param {object} secrets - Secrets manager (for interpolation)
 * @returns {object|null} - Parsed skill config or null if invalid
 */
export function parseSkill(name, content, secrets) {
  try {
    const lines = content.split('\n');
    const skill = {
      name,
      baseUrl: null,
      headers: {},
      endpoints: [],
      permissions: { http: [], shell: [], file: [] },
      notes: [],
    };

    let section = null;

    for (let line of lines) {
      line = line.trim();

      // Detect sections
      if (line.startsWith('## Auth')) {
        section = 'auth';
        continue;
      }
      if (line.startsWith('## Endpoints')) {
        section = 'endpoints';
        continue;
      }
      if (line.startsWith('## Permissions')) {
        section = 'permissions';
        continue;
      }
      if (line.startsWith('## Usage Notes') || line.startsWith('## Source')) {
        section = 'notes';
        continue;
      }

      // Parse based on section
      if (section === 'auth') {
        // Base URL: https://api.stripe.com/v1
        if (line.startsWith('Base URL:')) {
          skill.baseUrl = line.replace('Base URL:', '').trim();
        }
        // Header: Authorization: Bearer {{secrets.stripe_api_key}}
        if (line.startsWith('Header:')) {
          const headerLine = line.replace('Header:', '').trim();
          const [key, ...valueParts] = headerLine.split(':');
          const value = valueParts.join(':').trim();
          skill.headers[key.trim()] = value;
        }
      }

      if (section === 'endpoints') {
        // GET /customers - List customers
        // GET /customers/{{customer_id}} - Get customer by ID
        // POST /customers - Create customer
        const match = line.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s]*)\s*-\s*(.+)/i);
        if (match) {
          const [, method, path, description] = match;
          skill.endpoints.push({
            method: method.toUpperCase(),
            path: path.trim(),
            description: description.trim(),
          });
        }
      }

      if (section === 'permissions') {
        // - http: [api.stripe.com]
        // - shell: none
        // - file: [~/workspace/**]
        const match = line.match(/^-\s+(http|shell|file):\s*(.+)/i);
        if (match) {
          const [, type, value] = match;
          if (value === 'none') {
            skill.permissions[type] = [];
          } else {
            const cleaned = value.replace(/[\[\]]/g, '').trim();
            skill.permissions[type] = cleaned.split(',').map(v => v.trim()).filter(Boolean);
          }
        }
      }

      if (section === 'notes' && line.startsWith('- ')) {
        skill.notes.push(line.replace(/^-\s*/, ''));
      }
    }

    // Validate
    if (!skill.baseUrl || skill.endpoints.length === 0) {
      return null; // Invalid skill — missing critical fields
    }

    return skill;
  } catch (err) {
    return null;
  }
}

/**
 * Convert a parsed skill into tool definitions for the LLM
 * @param {object} skill - Parsed skill config
 * @returns {array} - Array of tool definitions
 */
export function skillToTools(skill) {
  const tools = [];

  for (const endpoint of skill.endpoints) {
    // Generate tool name from endpoint
    // GET /customers → skill_name__get_customers
    // POST /customers → skill_name__create_customer
    const pathSlug = endpoint.path
      .replace(/\{.*?\}/g, 'id') // Replace {{customer_id}} with id
      .replace(/[^a-z0-9_]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();

    const methodVerb = endpoint.method === 'GET' ? 'get' : 
                       endpoint.method === 'POST' ? 'create' :
                       endpoint.method === 'PUT' ? 'update' :
                       endpoint.method === 'PATCH' ? 'update' :
                       endpoint.method === 'DELETE' ? 'delete' : 'call';

    const toolName = `${skill.name}__${methodVerb}${pathSlug ? '_' + pathSlug : ''}`;

    // Extract path parameters (e.g. {{customer_id}}) — skip {{secrets.*}} which are resolved at runtime
    const pathParams = [];
    const paramMatches = endpoint.path.matchAll(/\{\{([^}]+)\}\}/g);
    for (const match of paramMatches) {
      if (!match[1].startsWith('secrets.')) {
        pathParams.push(match[1]);
      }
    }

    // Build input schema
    const properties = {};
    const required = [];

    for (const param of pathParams) {
      properties[param] = {
        type: 'string',
        description: `The ${param.replace(/_/g, ' ')}`,
      };
      required.push(param);
    }

    // Add query/body parameters for GET/POST
    if (endpoint.method === 'GET') {
      properties.limit = { type: 'number', description: 'Maximum number of results (default 10)' };
    }
    if (endpoint.method === 'POST' || endpoint.method === 'PUT' || endpoint.method === 'PATCH') {
      properties.data = { type: 'string', description: 'JSON payload for the request body' };
    }

    const inputSchema = {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };

    tools.push({
      name: toolName,
      description: endpoint.description,
      inputSchema,
      skill: skill.name,
      method: endpoint.method,
      path: endpoint.path,
    });
  }

  return tools;
}

/**
 * Execute a skill tool — makes the HTTP request
 * @param {object} tool - Tool definition (from skillToTools)
 * @param {object} skill - Parsed skill config
 * @param {object} args - Tool call arguments from LLM
 * @param {object} secrets - Secrets manager (for header interpolation)
 * @returns {string} - Tool result
 */
export async function executeSkillTool(tool, skill, args, secrets) {
  try {
    // Build URL — replace path params
    let url = skill.baseUrl + tool.path;
    for (const param of Object.keys(args)) {
      url = url.replace(`{{${param}}}`, encodeURIComponent(args[param]));
    }

    // Add query params for GET requests
    if (tool.method === 'GET' && args.limit) {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}limit=${args.limit}`;
    }

    // Build headers — interpolate secrets
    const headers = {};
    for (const [key, value] of Object.entries(skill.headers)) {
      let resolved = value;
      // Replace {{secrets.key}} with actual secret
      const secretMatches = value.matchAll(/\{\{secrets\.([^}]+)\}\}/g);
      for (const match of secretMatches) {
        const secretKey = match[1];
        const secretValue = await secrets.get(secretKey);
        if (secretValue) {
          resolved = resolved.replace(match[0], secretValue);
        } else {
          return `Error: Missing secret "${secretKey}" required for ${skill.name}`;
        }
      }
      headers[key] = resolved;
    }

    // Build request options
    const options = {
      method: tool.method,
      headers,
      signal: AbortSignal.timeout(15000),
    };

    // Add body for POST/PUT/PATCH
    if ((tool.method === 'POST' || tool.method === 'PUT' || tool.method === 'PATCH') && args.data) {
      options.body = args.data;
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    // Execute request
    const res = await fetch(url, options);
    const text = await res.text();

    if (!res.ok) {
      return `HTTP ${res.status}: ${text.slice(0, 500)}`;
    }

    // Try to parse JSON, otherwise return raw text
    try {
      const json = JSON.parse(text);
      return JSON.stringify(json, null, 2).slice(0, 4000);
    } catch {
      return text.slice(0, 4000);
    }
  } catch (err) {
    return `Error executing ${tool.name}: ${err.message}`;
  }
}
