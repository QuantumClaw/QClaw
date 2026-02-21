/**
 * QuantumClaw Terminal Branding
 * Cyan + Purple + Magenta. Cybernetic claw.
 */

const P = '\x1b[38;5;135m';   // purple
const LP = '\x1b[38;5;177m';  // light purple
const C = '\x1b[38;5;87m';    // cyan
const M = '\x1b[38;5;198m';   // magenta
const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const W = '\x1b[1;37m';

export function banner() {
  console.log('');
  console.log(`${D}  ──────────────────────────────────${R}`);
  console.log('');
  console.log(`  ${C}  /\\${R}    ${LP}Q${P}U${LP}A${P}N${LP}T${P}U${LP}M${M}C${LP}L${M}A${LP}W${R}`);
  console.log(`  ${C} /${M}<${C}\\${R}   ${D}agent runtime v1.0.0${R}`);
  console.log(`  ${C}/${M}/ \\${C}\\${R}`);
  console.log(`  ${M}\\${C}\\ /${M}/${R}   ${D}Your business, understood.${R}`);
  console.log(`  ${M} \\${C}>${M}/${R}    ${D}Not just remembered.${R}`);
  console.log(`  ${M}  \\/${R}`);
  console.log('');
  console.log(`${D}  ──────────────────────────────────${R}`);
  console.log('');
}

export function smallBanner() {
  console.log(`${C}/\\${R} ${LP}QuantumClaw${R} ${D}v1.0.0${R}`);
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
  green: '\x1b[38;5;82m',
  yellow: '\x1b[38;5;220m',
  red: '\x1b[38;5;196m',
};
