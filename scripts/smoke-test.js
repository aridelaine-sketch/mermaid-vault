'use strict';
/**
 * End-to-end smoke test. Launches the actual packaged-style app (not a
 * mock), drives real clicks and inputs through main.js's smoke-test
 * sequence, and verifies PNG/SVG/PDF exports are genuine files on disk.
 *
 *   npm run smoke-test
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.join(__dirname, '..');
const base = path.join(os.tmpdir(), 'mermaid-vault-smoke-' + Date.now());
const userData = path.join(base, 'userdata');
const exportsDir = path.join(base, 'exports');

fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(exportsDir, { recursive: true });

const electronPath = require('electron'); // resolves to the electron binary path when required from plain Node

const env = {
  ...process.env,
  MERMAID_VAULT_SMOKE_TEST: '1',
  MERMAID_VAULT_SMOKE_USERDATA: userData,
  MERMAID_VAULT_SMOKE_DIR: base,
  MERMAID_VAULT_SMOKE_EXPORTS: exportsDir
};

function hasXvfbRun() {
  const res = spawnSync('which', ['xvfb-run']);
  return res.status === 0;
}

const needsXvfb = !process.env.DISPLAY && hasXvfbRun();
const cmd = needsXvfb ? 'xvfb-run' : electronPath;
const args = needsXvfb ? ['-a', electronPath, root, '--no-sandbox'] : [root, '--no-sandbox'];

console.log('Running: ' + cmd + ' ' + args.join(' '));
const result = spawnSync(cmd, args, { env, encoding: 'utf-8' });

const out = (result.stdout || '') + '\n' + (result.stderr || '');
console.log(out.split('\n').filter((l) => !l.includes('Failed to connect to the bus')).join('\n'));

const ok = out.includes('SMOKE_TEST_OK') && result.status === 0;

console.log('\n' + (ok ? 'PASS' : 'FAIL'));
console.log('Screenshots: ' + path.join(base, 'screenshots'));
console.log('Exported files: ' + exportsDir);

process.exit(ok ? 0 : 1);
