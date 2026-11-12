'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const computerUse = require('../mcp-server/computer-use');
const windowsTools = require('../mcp-server/windows-tools');
const platform = require('../lib/platform');

function fakeRunner(stdout = '') {
  const calls = [];
  const runPowerShell = async (script, options) => {
    calls.push({ script, options });
    return { stdout, stderr: '', exitCode: 0, timedOut: false };
  };
  return { calls, runPowerShell };
}

test('Windows MCP exposes the Computer Use tool set without changing legacy tools', () => {
  const legacy = [
    { name: 'work_sync_status', description: 'sync', inputSchema: { type: 'object', properties: {} } },
    { name: 'xcode_build_and_deploy_iphone', description: 'xcode', inputSchema: { type: 'object', properties: {} } },
  ];
  const listed = windowsTools.describe(legacy);
  const names = listed.map((tool) => tool.name);
  assert(names.includes('work_sync_status'));
  assert(!names.includes('xcode_build_and_deploy_iphone'));
  for (const tool of computerUse.tools) assert(names.includes(tool.name));
});

test('window enumeration uses Win32 visible-window metadata and returns an array', async () => {
  const runner = fakeRunner('[{"hwnd":"123","title":"Unity","process":"Unity","processId":42,"x":0,"y":0,"width":1280,"height":720}]');
  const result = await computerUse.execute('computer_get_windows', {}, runner);
  assert.equal(result.handled, true);
  const parsed = JSON.parse(result.output);
  assert.equal(parsed.count, 1);
  assert.equal(parsed.windows[0].title, 'Unity');
  assert.match(runner.calls[0].script, /EnumWindows/);
  assert.match(runner.calls[0].script, /GetWindowRect/);
});

test('window focus accepts a numeric handle and rejects malformed handles before execution', async () => {
  const runner = fakeRunner();
  await computerUse.execute('computer_focus_window', { hwnd: '12345' }, runner);
  assert.match(runner.calls[0].script, /Focus\(\[long\]12345\)/);
  await assert.rejects(() => computerUse.execute('computer_focus_window', { hwnd: 'not-a-handle' }, runner), /hwnd/);
  assert.equal(runner.calls.length, 1);
});

test('mouse click validates bounds and emits the requested button/count', async () => {
  const runner = fakeRunner();
  await computerUse.execute('computer_click', { x: 500, y: 300, coordinate_space: 'physical', button: 'right', click_count: 2 }, runner);
  assert.match(runner.calls[0].script, /Click\(500,300,1,2\)/);
  await assert.rejects(() => computerUse.execute('computer_click', { x: 999999, y: 0 }, runner), /整数/);
  await assert.rejects(() => computerUse.execute('computer_click', { x: 0, y: 0, button: 'invalid' }, runner), /button/);
  assert.equal(runner.calls.length, 1);
});

test('text input escapes SendKeys control characters and limits payload size', async () => {
  const runner = fakeRunner();
  await computerUse.execute('computer_type_text', { text: 'a+b^c%~(){}\nnext\t' }, runner);
  assert.match(runner.calls[0].script, /SendWait/);
  for (const token of ['{+}', '{^}', '{%}', '{~}', '{(}', '{)}', '{{}', '{}}', '{TAB}']) {
    assert(runner.calls[0].script.includes(token), 'missing escaped token ' + token);
  }
  await assert.rejects(() => computerUse.execute('computer_type_text', { text: 'x'.repeat(2001) }, runner), /2000/);
  assert.equal(runner.calls.length, 1);
});

test('keyboard input only permits the documented shortcut allowlist', async () => {
  const runner = fakeRunner();
  await computerUse.execute('computer_press_key', { keys: 'CTRL+SHIFT+S' }, runner);
  assert.match(runner.calls[0].script, /Key\(17, \$true\)/);
  assert.match(runner.calls[0].script, /Key\(16, \$true\)/);
  assert.match(runner.calls[0].script, /Key\(83, \$true\)/);
  await assert.rejects(() => computerUse.execute('computer_press_key', { keys: 'CTRL+ALT+DELETE' }, runner), /不支持的快捷键/);
  await assert.rejects(() => computerUse.execute('computer_press_key', { keys: 'ALT+F4' }, runner), /不支持的快捷键/);
  assert.equal(runner.calls.length, 1);
});

test('scroll requires paired coordinates and drag validates every coordinate', async () => {
  const runner = fakeRunner();
  await computerUse.execute('computer_scroll', { delta: -120, x: 600, y: 400, coordinate_space: 'physical' }, runner);
  assert.match(runner.calls[0].script, /Scroll\(-120,600,400,\$true\)/);
  await assert.rejects(() => computerUse.execute('computer_scroll', { delta: 120, x: 5 }, runner), /同时提供/);
  await computerUse.execute('computer_drag', { from_x: 10, from_y: 20, to_x: 100, to_y: 200, coordinate_space: 'physical' }, runner);
  assert.match(runner.calls[1].script, /Drag\(10,20,100,200\)/);
});


test('mouse coordinates map from the returned screenshot to physical desktop pixels', async () => {
  const runner = fakeRunner();
  assert.equal(computerUse.recordScreenshot('node-map', {
    x: 100, y: 50, width: 2000, height: 1000, imageWidth: 1000, imageHeight: 500,
  }), true);
  const mapped = computerUse.mapPoint('node-map', 100, 50);
  assert.deepEqual(mapped, { x: 300, y: 150 });
  await computerUse.execute('computer_click', { x: 100, y: 50 }, { ...runner, nodeId: 'node-map' });
  assert.match(runner.calls[0].script, /Click\(300,150,0,1\)/);
  await assert.rejects(() => computerUse.execute('computer_click', { x: 100, y: 50 }, { ...runner, nodeId: 'missing-node' }), /先调用 computer_screenshot/);
});

test('wait duration is bounded', async () => {
  const runner = fakeRunner();
  const result = await computerUse.execute('computer_wait', { seconds: 0.1 }, runner);
  assert.equal(result.handled, true);
  await assert.rejects(() => computerUse.execute('computer_wait', { seconds: 11 }, runner), /0.1 到 10/);
});

test('Windows native Computer Use bridge compiles and enumerates windows', { skip: !platform.isWindows }, () => {
  const { spawnSync } = require('node:child_process');
  const script = "Add-Type -TypeDefinition " + platform.psQuote(computerUse.nativeSource) + " -Language CSharp; [TaktComputer]::GetWindows() | Out-Null; 'ok'";
  const result = spawnSync(platform.powershell, platform.psArgs(script), {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'PowerShell native bridge compile failed');
});
