import assert from 'node:assert/strict';
import { DashboardServer } from '../src/dashboard/server.js';

const server = new DashboardServer({ config: { dashboard: {} } });
const html = server._renderDashboard();

assert.match(html, /<meta name="color-scheme" content="light dark">/);
assert.match(html, /@media\(prefers-color-scheme: dark\)/);
assert.match(html, /function cssVar\(name,fallback=''\)/);
assert.match(html, /--canvas-svg-bg:/);

console.log('dashboard theme checks passed');
