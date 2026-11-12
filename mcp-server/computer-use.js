'use strict';

const { psQuote } = require('../lib/platform');

const NATIVE_SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed class TaktWindowInfo {
    public string hwnd { get; set; }
    public string title { get; set; }
    public string process { get; set; }
    public uint processId { get; set; }
    public int x { get; set; }
    public int y { get; set; }
    public int width { get; set; }
    public int height { get; set; }
}

public static class TaktComputer {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr extra);

    public static List<TaktWindowInfo> GetWindows() {
        var result = new List<TaktWindowInfo>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr extra) {
            if (!IsWindowVisible(hwnd)) return true;
            var title = new StringBuilder(1024);
            GetWindowText(hwnd, title, title.Capacity);
            var text = title.ToString().Trim();
            if (text.Length == 0) return true;
            RECT rect;
            if (!GetWindowRect(hwnd, out rect)) return true;
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            var processName = "";
            try { using (var p = Process.GetProcessById((int)pid)) processName = p.ProcessName; } catch {}
            result.Add(new TaktWindowInfo {
                hwnd = hwnd.ToInt64().ToString(), title = text, process = processName, processId = pid,
                x = rect.Left, y = rect.Top, width = Math.Max(0, rect.Right - rect.Left),
                height = Math.Max(0, rect.Bottom - rect.Top)
            });
            return true;
        }, IntPtr.Zero);
        return result;
    }

    public static bool Focus(long handle) {
        var hwnd = new IntPtr(handle);
        if (!IsWindow(hwnd)) return false;
        ShowWindow(hwnd, 9);
        Thread.Sleep(100);
        return SetForegroundWindow(hwnd);
    }

    private static bool InVirtualScreen(int x, int y) {
        int left = GetSystemMetrics(76), top = GetSystemMetrics(77);
        int width = GetSystemMetrics(78), height = GetSystemMetrics(79);
        return x >= left && y >= top && x < left + width && y < top + height;
    }

    public static bool Click(int x, int y, int button, int count) {
        if (!InVirtualScreen(x, y) || !SetCursorPos(x, y)) return false;
        uint down = button == 0 ? 0x0002U : button == 1 ? 0x0008U : 0x0020U;
        uint up = button == 0 ? 0x0004U : button == 1 ? 0x0010U : 0x0040U;
        for (int i = 0; i < count; i++) {
            mouse_event(down, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(55);
            mouse_event(up, 0, 0, 0, UIntPtr.Zero);
            if (i + 1 < count) Thread.Sleep(90);
        }
        return true;
    }

    public static bool Drag(int fromX, int fromY, int toX, int toY) {
        if (!InVirtualScreen(fromX, fromY) || !InVirtualScreen(toX, toY) || !SetCursorPos(fromX, fromY)) return false;
        mouse_event(0x0002U, 0, 0, 0, UIntPtr.Zero);
        try {
            Thread.Sleep(100);
            if (!SetCursorPos(toX, toY)) return false;
            Thread.Sleep(120);
            return true;
        } finally { mouse_event(0x0004U, 0, 0, 0, UIntPtr.Zero); }
    }

    public static bool Scroll(int delta, int x, int y, bool movePointer) {
        if (movePointer && (!InVirtualScreen(x, y) || !SetCursorPos(x, y))) return false;
        mouse_event(0x0800U, 0, 0, unchecked((uint)delta), UIntPtr.Zero);
        return true;
    }

    public static void Key(int virtualKey, bool down) {
        keybd_event((byte)virtualKey, 0, down ? 0U : 0x0002U, UIntPtr.Zero);
    }
}
`;

const MODIFIERS = { CTRL: 0x11, ALT: 0x12, SHIFT: 0x10 };
const SPECIAL_KEYS = {
  ENTER: 0x0D, TAB: 0x09, ESC: 0x1B, BACKSPACE: 0x08, DELETE: 0x2E, SPACE: 0x20,
  UP: 0x26, DOWN: 0x28, LEFT: 0x25, RIGHT: 0x27, HOME: 0x24, END: 0x23,
  PAGEUP: 0x21, PAGEDOWN: 0x22, INSERT: 0x2D,
};

const tools = [
  { name: 'computer_screenshot', description: '截取 Windows 当前交互式桌面或指定区域，并将 PNG 图片直接返回给 Claude 进行视觉分析。需要已登录且未锁屏的 Windows 桌面会话。', inputSchema: { type: 'object', properties: { activate_app: { type: 'string' }, region: { type: 'string', description: 'x,y,width,height' }, max_dimension_px: { type: 'number' }, return_inline_image: { type: 'boolean' } } } },
  { name: 'computer_get_windows', description: '列出 Windows 当前可见顶层窗口，返回窗口句柄、标题、进程名和屏幕位置；不返回命令行或用户文件内容。', inputSchema: { type: 'object', properties: {} } },
  { name: 'computer_focus_window', description: '将指定窗口恢复并置于前台。窗口句柄必须来自 computer_get_windows。', inputSchema: { type: 'object', properties: { hwnd: { type: 'string', description: 'computer_get_windows 返回的窗口句柄。' } }, required: ['hwnd'] } },
  { name: 'computer_click', description: '在 Windows 虚拟桌面坐标执行鼠标单击或双击。坐标单位为屏幕物理像素；多显示器可使用负坐标。', inputSchema: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, button: { type: 'string', enum: ['left', 'right', 'middle'] }, click_count: { type: 'integer', enum: [1, 2] } }, required: ['x', 'y'] } },
  { name: 'computer_type_text', description: '向当前前台窗口输入文字。通过 Windows SendKeys 输入；换行转换为 Enter、Tab 转换为 Tab。最多 2000 个字符。', inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 2000 } }, required: ['text'] } },
  { name: 'computer_press_key', description: '向当前前台窗口发送安全快捷键，例如 CTRL+S、CTRL+SHIFT+S、ENTER、ESC、ALT+TAB。禁止发送 CTRL+ALT+DELETE。', inputSchema: { type: 'object', properties: { keys: { type: 'string', enum: ['ENTER','TAB','ESC','BACKSPACE','DELETE','SPACE','UP','DOWN','LEFT','RIGHT','HOME','END','PAGEUP','PAGEDOWN','INSERT','CTRL+A','CTRL+C','CTRL+V','CTRL+X','CTRL+S','CTRL+Z','CTRL+Y','CTRL+SHIFT+S','CTRL+F','CTRL+P','ALT+TAB','ALT+ENTER','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'] } }, required: ['keys'] } },
  { name: 'computer_scroll', description: '在当前鼠标位置或指定坐标滚动鼠标滚轮。delta 正数向上，负数向下。', inputSchema: { type: 'object', properties: { delta: { type: 'integer', minimum: -2400, maximum: 2400 }, x: { type: 'integer' }, y: { type: 'integer' } }, required: ['delta'] } },
  { name: 'computer_drag', description: '执行鼠标左键拖拽，常用于拖动窗口、编辑器对象或滚动条。坐标为虚拟桌面物理像素。', inputSchema: { type: 'object', properties: { from_x: { type: 'integer' }, from_y: { type: 'integer' }, to_x: { type: 'integer' }, to_y: { type: 'integer' } }, required: ['from_x','from_y','to_x','to_y'] } },
  { name: 'computer_wait', description: '等待 Windows 应用界面响应或完成刷新，等待时间限制为 0.1 至 10 秒。', inputSchema: { type: 'object', properties: { seconds: { type: 'number', minimum: 0.1, maximum: 10 } } } },
];

function integer(value, name, min = -32768, max = 32767) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(name + ' 必须是 ' + min + ' 到 ' + max + ' 之间的整数');
  return n;
}

function parseHandle(value) {
  const raw = String(value || '').trim();
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(raw)) throw new Error('hwnd 必须是 computer_get_windows 返回的句柄');
  const n = BigInt(raw);
  if (n <= 0n || n > 0x7fffffffffffffffn) throw new Error('无效窗口句柄');
  return n.toString(10);
}

function keySequence(value) {
  const parts = String(value || '').trim().toUpperCase().split('+');
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !p)) throw new Error('快捷键格式无效');
  const modifiers = [];
  let main = '';
  for (const part of parts) {
    if (MODIFIERS[part]) {
      if (modifiers.includes(part)) throw new Error('快捷键包含重复修饰键');
      modifiers.push(part);
    } else if (main) throw new Error('只允许一个主按键');
    else main = part;
  }
  if (!main) throw new Error('快捷键缺少主按键');
  if (modifiers.includes('CTRL') && modifiers.includes('ALT') && main === 'DELETE') throw new Error('出于安全原因不允许发送 CTRL+ALT+DELETE');
  let vk = SPECIAL_KEYS[main];
  if (!vk && /^[A-Z]$/.test(main)) vk = main.charCodeAt(0);
  if (!vk && /^[0-9]$/.test(main)) vk = main.charCodeAt(0);
  if (!vk && /^F(?:[1-9]|1[0-2])$/.test(main)) vk = 0x70 + Number(main.slice(1)) - 1;
  if (!vk) throw new Error('不支持的按键：' + main);
  return { modifiers: modifiers.map((m) => MODIFIERS[m]), main: vk };
}

function escapeSendKeys(value) {
  const map = { '+': '{+}', '^': '{^}', '%': '{%}', '~': '{~}', '(': '{(}', ')': '{)}', '{': '{{}', '}': '{}}', '\n': '~', '\t': '{TAB}' };
  return value.replace(/\r\n?/g, '\n').split('').map((ch) => map[ch] || ch).join('');
}

function withNative(body) {
  return "Add-Type -TypeDefinition " + psQuote(NATIVE_SOURCE) + " -Language CSharp; " + body;
}

async function execute(name, args = {}, context = {}) {
  const names = new Set(tools.map((tool) => tool.name));
  if (!names.has(name) || name === 'computer_screenshot') return { handled: false };
  if (typeof context.runPowerShell !== 'function') throw new Error('Windows PowerShell 执行器未配置');
  const run = context.runPowerShell;

  switch (name) {
    case 'computer_get_windows': {
      const result = await run(withNative("$windows = [TaktComputer]::GetWindows(); ConvertTo-Json -InputObject @($windows) -Compress -Depth 4"), { timeoutMs: 12000 });
      let windows = [];
      try { windows = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : []; } catch { throw new Error('Windows 窗口列表解析失败'); }
      if (!Array.isArray(windows)) windows = [windows];
      return { handled: true, output: JSON.stringify({ count: windows.length, windows }, null, 2) };
    }
    case 'computer_focus_window': {
      const hwnd = parseHandle(args.hwnd);
      await run(withNative("if (-not [TaktComputer]::Focus([long]" + hwnd + ")) { throw '窗口不存在或 Windows 拒绝切换前台窗口' }; 'focused'"), { timeoutMs: 8000 });
      return { handled: true, output: '已请求激活窗口 ' + hwnd };
    }
    case 'computer_click': {
      const x = integer(args.x, 'x'), y = integer(args.y, 'y');
      const button = ({ left: 0, right: 1, middle: 2 })[args.button || 'left'];
      if (button === undefined) throw new Error('button 只能是 left、right 或 middle');
      const count = Number(args.click_count ?? 1);
      if (![1, 2].includes(count)) throw new Error('click_count 只能是 1 或 2');
      await run(withNative("if (-not [TaktComputer]::Click(" + x + "," + y + "," + button + "," + count + ")) { throw '坐标超出虚拟桌面范围或鼠标定位失败' }; 'clicked'"), { timeoutMs: 8000 });
      return { handled: true, output: (count === 2 ? '已双击' : '已点击') + ' (' + x + ', ' + y + ') ' + (args.button || 'left') };
    }
    case 'computer_type_text': {
      if (typeof args.text !== 'string') throw new Error('text 必须是字符串');
      if (args.text.length > 2000) throw new Error('单次输入最多 2000 个字符');
      if (/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(args.text)) throw new Error('输入包含不支持的控制字符');
      await run("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(" + psQuote(escapeSendKeys(args.text)) + "); 'typed'", { timeoutMs: 12000 });
      return { handled: true, output: '已向当前前台窗口发送 ' + args.text.length + ' 个字符' };
    }
    case 'computer_press_key': {
      const sequence = keySequence(args.keys);
      const down = sequence.modifiers.map((vk) => '[TaktComputer]::Key(' + vk + ', $true)');
      const up = sequence.modifiers.slice().reverse().map((vk) => '[TaktComputer]::Key(' + vk + ', $false)');
      const script = withNative([...down, '[TaktComputer]::Key(' + sequence.main + ', $true)', 'Start-Sleep -Milliseconds 40', '[TaktComputer]::Key(' + sequence.main + ', $false)', ...up, "'key sent'"].join('; '));
      await run(script, { timeoutMs: 8000 });
      return { handled: true, output: '已发送快捷键 ' + String(args.keys).toUpperCase() };
    }
    case 'computer_scroll': {
      const delta = integer(args.delta, 'delta', -2400, 2400);
      if ((args.x !== undefined && args.y === undefined) || (args.x === undefined && args.y !== undefined)) throw new Error('x 和 y 必须同时提供');
      const move = args.x !== undefined;
      const x = move ? integer(args.x, 'x') : 0, y = move ? integer(args.y, 'y') : 0;
      await run(withNative("if (-not [TaktComputer]::Scroll(" + delta + "," + x + "," + y + "," + (move ? '$true' : '$false') + ")) { throw '滚轮坐标超出虚拟桌面范围' }; 'scrolled'"), { timeoutMs: 8000 });
      return { handled: true, output: '已滚动鼠标滚轮 delta=' + delta };
    }
    case 'computer_drag': {
      const fromX = integer(args.from_x, 'from_x'), fromY = integer(args.from_y, 'from_y');
      const toX = integer(args.to_x, 'to_x'), toY = integer(args.to_y, 'to_y');
      await run(withNative("if (-not [TaktComputer]::Drag(" + fromX + "," + fromY + "," + toX + "," + toY + ")) { throw '拖拽坐标超出虚拟桌面范围或鼠标定位失败' }; 'dragged'"), { timeoutMs: 10000 });
      return { handled: true, output: '已拖拽 (' + fromX + ', ' + fromY + ') 到 (' + toX + ', ' + toY + ')' };
    }
    case 'computer_wait': {
      const seconds = Number(args.seconds ?? 1);
      if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 10) throw new Error('seconds 必须在 0.1 到 10 秒之间');
      await new Promise((resolve) => setTimeout(resolve, Math.round(seconds * 1000)));
      return { handled: true, output: '已等待 ' + seconds + ' 秒' };
    }
    default:
      return { handled: false };
  }
}

module.exports = { tools, execute, keySequence, escapeSendKeys };
