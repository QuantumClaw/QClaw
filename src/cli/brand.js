/**
 * QuantumClaw Terminal Branding
 * Cyan + Purple + Red. Cybernetic claw.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let _ver;
function ver() {
  if (!_ver) {
    try { _ver = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8')).version; }
    catch { _ver = '0.0.0'; }
  }
  return _ver;
}

const P = '\x1b[38;5;135m';   // purple
const LP = '\x1b[38;5;177m';  // light purple
const C = '\x1b[38;5;87m';    // cyan
const M = '\x1b[38;5;198m';   // magenta
const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const W = '\x1b[1;37m';
const RD = '\x1b[38;5;196m';  // red
const G = '\x1b[38;5;82m';    // green

// Detect narrow terminal (mobile / Termux)
function isMobile() {
  try { return (process.stdout.columns || 80) < 60; } catch { return false; }
}

export function banner() {
  if (isMobile()) {
    smallBanner();
    console.log('');
    console.log(`${D}  ──────────────────────────────────${R}`);
    console.log(`  ${D}The agent runtime with a knowledge${R}`);
    console.log(`  ${D}graph for a brain.${R}`);
    console.log(`  ${C}v${ver()}${D} · ${LP}Cognee${D} · ${RD}AGEX${R}`);
    console.log(`${D}  ──────────────────────────────────${R}`);
    console.log('');
    return;
  }

  console.log('');
  console.log(`${C}                     ░▓▓██▓█▓▓▓▓░░░${R}`);
  console.log(`${C}                   ▓▓█▓▓▓░▓░▓▓▓▓▓▓▓▓▓▓▓▓▓▓${R}`);
  console.log(`${C}                ░▓█▓▓▓░░░░▓${R} ${C}░░░░░░░░▓▓▓█▓█▓${R}`);
  console.log(`${C}              ░▓██▓▓▓░▓░░▓░▓░▓▓▓▓▓▓░░░▓▓░░██${R}`);
  console.log(`${C}          ░░▓██▓▓▓░▓░░▓░█▓${R} ${C}░▓▓▓▓▓▓▓▓░█▓░▓▓▓▓█░${R}`);
  console.log(`${C}       ░▓████▓░░▓▓░▓▓▓█${W}█${C}▓${R}            ${C}▓▓▓▓▓▓▓▓█░${R}`);
  console.log(`${C}      ███▓▓▓░▓░▓${R} ${C}▓▓▓░██░${R}               ${C}░░▓████${W}█${C}░${R}`);
  console.log(`${C}    ░${W}█${C}▓▓█${R} ${C}▓░░▓░▓░▓░▓█▓${R}                     ${C}░▓█${W}██${C}▓${R}`);
  console.log(`${C}   ▓${W}█${C}█▓▓▓▓${R} ${C}░▓░░▓▓▓░▓░${R}                         ${C}░▓█▓${R}`);
  console.log(`${C}  ▓${W}█${C}▓▓▓▓▓▓▓░░░░▓▓▓▓▓${R}`);
  console.log(`${C} ██▓▓▓▓▓▓▓▓░▓░░░▓░▓▓█${R}`);
  console.log(`${C}█▓░░▓▓▓░▓░▓▓${R} ${C}▓${R} ${C}▓▓░▓▓█${R}`);
  console.log(`${C}▓▓░▓▓▓▓▓▓▓▓░░▓░▓░░▓▓█${R}`);
  console.log(`${C}▓▓░▓▓▓▓▓▓░░░░░░░▓░▓▓█${R}`);
  console.log(`${C}░░░▓▓▓▓░░░░░▓░░▓▓▓▓▓${R}`);
  console.log(`${C} ░▓▓░▓${R} ${C}▓▓▓░▓▓░░▓▓▓░█░${R}                          ${C}░█▓${R}`);
  console.log(`${C}░▓░▓░▓░▓░░▓░░▓░▓░░░▓█▓${R}                     ${C}░▓█${W}██${C}▓${R}`);
  console.log(`${C} ░▓▓░▓░▓░▓░░░░▓░${R} ${C}▓▓░▓██░${R}                ${C}░▓███${W}██${C}▓${R}`);
  console.log(`${C}   ░▓▓▓░░▓▓▓▓▓░░▓▓░▓▓░▓█▓${R}            ${C}░▓▓▓▓▓▓▓█░${R}`);
  console.log(`${C}     ░▓▓░░▓▓░▓▓▓▓▓▓▓░▓▓░▓▓${R} ${C}░░░▓▓▓▓▓▓░▓▓░░▓▓▓█░${R}`);
  console.log(`${C}              ░▓█▓░▓▓░░░${R} ${C}▓░█▓▓▓▓▓▓▓▓▓░░▓░░▓█░${R}`);
  console.log(`${C}                 ▓▓▓▓░▓░░░▓${R} ${C}░░▓░░░░░░░▓█▓▓█${R}`);
  console.log(`${C}                   ░▓█▓░▓░▓░▓▓▓▓▓▓▓▓▓▓▓▓▓▓${R}`);
  console.log(`${C}                      ▓▓▓▓▓▓█▓▓▓░░░${R}`);
  console.log('');
  console.log(`${W}   ██████╗ ██╗   ██╗ █████╗ ███╗  ██╗████████╗██╗   ██╗███╗   ███╗${R}`);
  console.log(`${W}  ██╔═══██╗██║   ██║██╔══██╗████╗ ██║╚══██╔══╝██║   ██║████╗ ████║${R}`);
  console.log(`${C}  ██║   ██║██║   ██║███████║██╔██╗██║   ██║   ██║   ██║██╔████╔██║${R}`);
  console.log(`${C}  ╚██████╔╝╚██████╔╝██║  ██║██║╚████║   ██║   ╚██████╔╝██║ ╚═╝ ██║${R}`);
  console.log(`${D}   ╚═══╝    ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚══╝   ╚═╝    ╚═══╝  ╚═╝     ╚═╝${R}`);
  console.log(`${RD}            ██████╗██╗      █████╗ ██╗    ██╗${R}`);
  console.log(`${RD}           ██╔════╝██║     ██╔══██╗██║    ██║${R}`);
  console.log(`${D}           ██║     ██║     ███████║██║ █╗ ██║${R}`);
  console.log(`${D}           ╚██████╗███████╗██║  ██║╚███╔███╔╝${R}`);
  console.log(`${D}            ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝${R}`);
  console.log('');
  console.log(`${D}  ──────────────────────────────────────────────────────────${R}`);
  console.log(`  ${D}The agent runtime with a knowledge graph for a brain.${R}`);
  console.log(`  ${C}v${ver()}${D} · ${LP}Cognee${D} · ${RD}AGEX${R}`);
  console.log(`${D}  ──────────────────────────────────────────────────────────${R}`);
  console.log('');
}

export function smallBanner() {
  if (isMobile()) {
    console.log('');
    console.log(`  ${C}⚛${R} ${W}${B}QUANTUM${RD}${B}CLAW${R} ${D}v${ver()}${R}`);
    return;
  }

  console.log('');
  console.log(`${C}         ░███░░░░░░░${R}`);
  console.log(`${C}      ░░█░░░░░░░░░█░█${R}`);
  console.log(`${C}   ░░██░░░██${R}      ${C}░░██░${R}`);
  console.log(`${C}  ██░░░░░░░${R}         ${C}░░█░${R}`);
  console.log(`${C}░██░░░░░░░${R}`);
  console.log(`${C}█░░░░░░░░█░${R}`);
  console.log(`${C}░░░░░░░░░░${R}`);
  console.log(`${C}░░░░░░░░░█░${R}         ${C}░░█░${R}`);
  console.log(`${C}  ░░░░░░░░░░${R}      ${C}░░██░${R}`);
  console.log(`${C}       ░░░░░░░░░░░░░█${R}`);
  console.log(`${C}         ░░░░░░░░░░░${R}`);
  console.log(`${W}${B}QUANTUM${RD}${B}CLAW${R} ${D}v${ver()}${R}`);
}

export const theme = {
  purple: P,
  lightPurple: LP,
  cyan: C,
  magenta: M,
  reset: R,
  bold: B,
  dim: D,
  white: W,
  green: G,
  yellow: '\x1b[38;5;220m',
  red: RD,
};
