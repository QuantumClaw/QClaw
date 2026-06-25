/**
 * Unit tests for the IM-style timestamp formatter used in the dashboard thread list.
 * Mirrors the ta() function from src/dashboard/ui.html.
 * Run with: node tests/ta-format.test.js
 */

function ta(ts) {
  if (!ts) return '';
  const now = new Date();
  const d = new Date(ts);
  const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const n = Math.round((s - t) / 86400000);
  if (n === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (n === 1) return 'Yesterday';
  if (n < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

let passed = 0;
let failed = 0;

function assert(desc, actual, expected) {
  if (actual === expected) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ ${desc}: expected "${expected}", got "${actual}"`);
    failed++;
  }
}

// null / undefined / empty string
assert('null → empty string', ta(null), '');
assert('undefined → empty string', ta(undefined), '');
assert('empty string → empty string', ta(''), '');

// today — should return HH:MM
const todayMid = new Date();
todayMid.setHours(14, 30, 0, 0);
const todayResult = ta(todayMid.toISOString());
assert('today shows HH:MM format', /^\d{2}:\d{2}$/.test(todayResult), true);

// yesterday
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
assert('yesterday → "Yesterday"', ta(yesterday.toISOString()), 'Yesterday');

// 3 days ago — should return a full day name
const threeDaysAgo = new Date();
threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
assert('3 days ago → a weekday name', dayNames.includes(ta(threeDaysAgo.toISOString())), true);

// 6 days ago — still within-week
const sixDaysAgo = new Date();
sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
assert('6 days ago → a weekday name', dayNames.includes(ta(sixDaysAgo.toISOString())), true);

// 7 days ago — should return a short date (not a day name, not "Yesterday")
const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
const sevenResult = ta(sevenDaysAgo.toISOString());
assert('7 days ago → not a weekday name', !dayNames.includes(sevenResult), true);
assert('7 days ago → not "Yesterday"', sevenResult !== 'Yesterday', true);
assert('7 days ago → non-empty', sevenResult !== '', true);

// 30 days ago
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
const thirtyResult = ta(thirtyDaysAgo.toISOString());
assert('30 days ago → not a weekday name', !dayNames.includes(thirtyResult), true);
assert('30 days ago → non-empty', thirtyResult !== '', true);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
