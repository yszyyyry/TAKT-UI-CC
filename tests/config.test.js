'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('config derives runtime paths from TAKT_HOME and creates an MCP token', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takt-config-'));
  try {
    const script = "const cfg=require('./config');const fs=require('node:fs');const token=cfg.getMcpToken();process.stdout.write(JSON.stringify({home:cfg.TAKT_HOME,work:cfg.DEFAULT_WORK_DIR,token,mode:(fs.statSync(cfg.TAKT_HOME+'/mcp-token').mode & 0o777).toString(8)}));";
    const child = spawnSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, TAKT_HOME: dir, TAKT_MCP_TOKEN: '' },
    });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.home, dir);
    assert.equal(result.work, path.join(dir, 'work'));
    assert.equal(result.token.length, 48);
    if (process.platform !== 'win32') assert.equal(result.mode, '600');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
