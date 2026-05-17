/**
 * Slice 3d — argv parser unit tests
 *
 * Covers every parse-time rejection category, every state-machine
 * transition with shell metacharacters, and the round-1-3 R findings.
 * See design SSOT /tmp/slice3d_design.md §1 + Appendix B for the
 * pinned cases.
 */

import { parse, parseAndValidate } from '../src/tools/shell-exec-parser.js';

let passed = 0;
let failed = 0;
function check(name, cond, detail = null) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
    if (detail !== null) console.log(`      detail: ${JSON.stringify(detail).slice(0, 300)}`);
  }
}

function assertRej(label, input, expectedError, expectedReason) {
  const r = parse(input);
  check(
    `${label} → ${expectedError}/${expectedReason}`,
    !r.ok && r.error === expectedError && r.reason === expectedReason,
    r,
  );
}

function assertOk(label, input, expectedArgv) {
  const r = parse(input);
  const ok = r.ok && JSON.stringify(r.argv) === JSON.stringify(expectedArgv);
  check(`${label} → argv=${JSON.stringify(expectedArgv)}`, ok, r);
}

console.log('\n=== A. Pre-scan rejections ===');
assertRej('too_long (>8 KiB)', 'cat ' + 'a'.repeat(9000), 'parse_error', 'too_long');
assertRej('null byte', 'cat /tmp/x\0/etc/passwd', 'parse_error', 'null_byte');
assertRej('U+2028 line sep', 'cat /tmp/x /etc/passwd', 'parse_error', 'non_ascii');
assertRej('U+2029 para sep', 'cat /tmp/x /etc/passwd', 'parse_error', 'non_ascii');
assertRej('byte > 0x7E (0x80)', 'cat /tmp/x' + String.fromCharCode(0x80), 'parse_error', 'non_ascii');
assertRej('vertical tab', 'cat /tmp/x\v', 'parse_error', 'non_ascii');

console.log('\n=== B. DEFAULT-state metachar rejections (R1..R4 catches) ===');
assertRej('newline (R1)', 'pm2 list\necho pwned', 'rejected_feature', 'newline');
assertRej('CR', 'pm2 list\recho pwned', 'rejected_feature', 'newline');
assertRej('semicolon chain', 'ls ; rm', 'rejected_feature', 'command_separator');
assertRej('pipe', 'ls | cat', 'rejected_feature', 'command_separator');
assertRej('background &', 'ls &', 'rejected_feature', 'command_separator');
assertRej('redirect > (R2)', 'cat /tmp/x > /tmp/../etc/passwd', 'rejected_feature', 'redirect');
assertRej('redirect <', 'cat < /tmp/x', 'rejected_feature', 'redirect');
assertRej('subshell open (', 'cat (echo)', 'rejected_feature', 'subshell');
assertRej('subshell close )', 'cat )foo', 'rejected_feature', 'subshell');
assertRej('variable expansion (R3)', 'cat $HOME/.ssh/id_rsa', 'rejected_feature', 'variable_expansion');
assertRej('command substitution backtick', 'cat `whoami`', 'rejected_feature', 'command_substitution');
assertRej('tilde at token start (R3)', 'cat ~/.quantumclaw/config.json', 'rejected_feature', 'tilde_expansion');
assertRej('glob *', 'ls *.json', 'rejected_feature', 'glob_or_brace');
assertRej('glob ?', 'ls a?.txt', 'rejected_feature', 'glob_or_brace');
assertRej('brace open', 'ls {a,b}', 'rejected_feature', 'glob_or_brace');
assertRej('brace close', 'ls }foo', 'rejected_feature', 'glob_or_brace');
assertRej('char class [', 'ls [a-z]', 'rejected_feature', 'glob_or_brace');
assertRej('char class ]', 'ls ]foo', 'rejected_feature', 'glob_or_brace');
assertRej('# at token start', 'ls #comment', 'rejected_feature', 'comment');

console.log('\n=== C. Tilde / # tokenise-through at token-mid ===');
// "/tmp/foo~bar" tokenises through — but /tmp/foo~bar starts a token
// with /, so by the time we hit ~ bufferStarted is true.
assertOk('tilde mid-token', 'ls /tmp/foo~bar', ['ls', '/tmp/foo~bar']);
assertOk('# mid-token', 'ls foo#bar', ['ls', 'foo#bar']);

console.log('\n=== D. Escape handling (DEFAULT) ===');
assertOk('backslash space', 'ls a\\ b', ['ls', 'a b']);
assertOk('backslash backslash', 'ls a\\\\b', ['ls', 'a\\b']);
assertRej('dangling escape EOI', 'cat \\', 'parse_error', 'dangling_escape');
assertRej('line continuation', 'ls \\\n', 'rejected_feature', 'line_continuation');

console.log('\n=== E. Single-quote handling ===');
assertOk("empty single quote pair", "ls ''", ['ls', '']);
assertOk('single quote literal', "ls 'foo bar'", ['ls', 'foo bar']);
assertOk('single quote with $', "ls 'a$b'", ['ls', 'a$b']);
assertOk('single quote with backtick', "ls 'a`b'", ['ls', 'a`b']);
assertOk('single quote with metas inside', "ls 'a;b|c&d'", ['ls', 'a;b|c&d']);
assertRej('unterminated single', "ls 'abc", 'parse_error', 'unterminated_single_quote');

console.log('\n=== F. Double-quote handling ===');
assertOk('empty double quote pair', 'ls ""', ['ls', '']);
assertOk('hello world', 'ls "hello world"', ['ls', 'hello world']);
assertOk('escaped close quote', 'cat "a\\"b"', ['cat', 'a"b']);
assertOk('escaped backslash', 'cat "a\\\\b"', ['cat', 'a\\b']);
assertOk('literal \\n (not newline)', 'cat "a\\nb"', ['cat', 'a\\nb']);
assertRej('dollar inside double', 'cat "$HOME"', 'rejected_feature', 'variable_expansion');
assertRej('backtick inside double', 'cat "`id`"', 'rejected_feature', 'command_substitution');
assertRej('unterminated double', 'cat "abc', 'parse_error', 'unterminated_double_quote');
assertRej('dangling escape in double', 'cat "abc\\', 'parse_error', 'dangling_escape');

console.log('\n=== G. Concatenation / adjacent quotes ===');
assertOk('a"b"c', 'ls a"b"c', ['ls', 'abc']);
assertOk("a'b'c", "ls a'b'c", ['ls', 'abc']);
assertOk("empty quote concatenations", "ls ''\"\"''", ['ls', '']);

console.log('\n=== H. Whitespace ===');
assertOk('leading ws', '   ls', ['ls']);
assertOk('trailing ws', 'ls   ', ['ls']);
assertOk('multiple spaces', 'ls    /tmp', ['ls', '/tmp']);
assertOk('tab separated', 'ls\t/tmp', ['ls', '/tmp']);
assertOk('mixed tab/space', 'ls \t /tmp', ['ls', '/tmp']);
assertOk('all whitespace → empty argv', '    ', []);

console.log('\n=== I. R-finding attack inputs (verbatim from Appendix A) ===');
// R1
assertRej("R1.1 'pm2 list\\necho pwned'", 'pm2 list\necho pwned', 'rejected_feature', 'newline');
// R2.1 awk {system}
assertRej("R2.1 awk BEGIN{system(\"id\")}", 'awk BEGIN{system("id")}', 'rejected_feature', 'glob_or_brace');
// R2.5 cat ... > ... — already tested above
// R3.2
assertRej("R3.2 cat $HOME/.ssh/id_rsa", 'cat $HOME/.ssh/id_rsa', 'rejected_feature', 'variable_expansion');
// R3.3
assertRej("R3.3 cat ~/.quantumclaw/config.json", 'cat ~/.quantumclaw/config.json', 'rejected_feature', 'tilde_expansion');
// R3.5 process substitution
assertRej("R3.5 cat <(curl evil)", 'cat <(curl evil)', 'rejected_feature', 'redirect');

console.log('\n=== J. parseAndValidate plumbing (parse→dispatch→schema basics) ===');
// We only assert the high-level error shape here — schemas test is the
// dedicated suite.
{
  const r = parseAndValidate('');
  check('empty input → unknown_verb', !r.ok && r.error === 'unknown_verb', r);
}
{
  const r = parseAndValidate('   ');
  check('all-whitespace input → unknown_verb', !r.ok && r.error === 'unknown_verb', r);
}
{
  const r = parseAndValidate('nope');
  check('unknown verb', !r.ok && r.error === 'unknown_verb', r);
}
{
  const r = parseAndValidate('ls');
  check('ls (no args) → ok', r.ok && r.schemaKey === 'ls', r);
}

console.log(`\n=== shell-exec-parser.test.js: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
