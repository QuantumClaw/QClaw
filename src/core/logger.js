/**
 * QuantumClaw Logger
 * Purple-themed, clean, no noise.
 */

const PURPLE = '\x1b[38;5;135m';
const LIGHT_PURPLE = '\x1b[38;5;177m';
const GREEN = '\x1b[38;5;82m';
const YELLOW = '\x1b[38;5;220m';
const RED = '\x1b[38;5;196m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function timestamp() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

export const log = {
  info(msg) {
    console.log(`${DIM}${timestamp()}${RESET} ${PURPLE}▸${RESET} ${msg}`);
  },

  success(msg) {
    console.log(`${DIM}${timestamp()}${RESET} ${GREEN}✓${RESET} ${msg}`);
  },

  warn(msg) {
    console.log(`${DIM}${timestamp()}${RESET} ${YELLOW}⚠${RESET} ${msg}`);
  },

  error(msg) {
    console.log(`${DIM}${timestamp()}${RESET} ${RED}✗${RESET} ${msg}`);
  },

  agent(name, msg) {
    console.log(`${DIM}${timestamp()}${RESET} ${LIGHT_PURPLE}[${name}]${RESET} ${msg}`);
  },

  cost(msg) {
    console.log(`${DIM}${timestamp()}${RESET} ${PURPLE}£${RESET} ${msg}`);
  },

  debug(msg) {
    if (process.env.QCLAW_DEBUG) {
      console.log(`${DIM}${timestamp()} ○ ${msg}${RESET}`);
    }
  }
};
