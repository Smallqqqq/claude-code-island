---
name: island
description: 桌面级灵动岛状态胶囊。在屏幕顶部显示 Claude Code 实时工作状态。使用 /island 管理。
---

# 灵动岛 (Dynamic Island) for Claude Code

一个桌面级灵动岛风格的状态胶囊，固定在屏幕顶部，实时显示 Claude Code 当前正在做什么。

- **macOS**: 利用 MacBook 刘海区域，原生 Cocoa + WKWebView
- **Windows**: 屏幕顶部居中胶囊，WinForms + WebView2

## 架构

```
Claude Code hooks (settings.json)
  ↓ PreToolUse / PostToolUse / UserPromptSubmit / Stop
bridge.mjs  (一次性进程，每次 hook 调用)
  ↓ Named pipe / Unix socket
companion.mjs  (常驻守护进程)
  ↓ stdin/stdout JSON-line 协议
原生窗口 (Swift/C# WebView)
  └─ 渲染黑色胶囊 HTML
```

## 目录结构

所有文件位于本 skill 所在目录 `island/` 下：

| 文件 | 作用 |
|------|------|
| `companion.mjs` | 常驻守护进程，管理 WebView 窗口 + socket 服务 |
| `bridge.mjs` | Hook 桥接脚本，Claude Code hooks 调用它来更新状态 |
| `build.mjs` | 编译原生主机二进制文件 |
| `island.html.mjs` | WebView 内渲染的 HTML/CSS/JS |
| `open-fixed.mjs` | 原生主机进程的 spawn 封装 |
| `platform.mjs` | 平台抽象层（屏幕检测、窗口定位） |
| `socket-path.mjs` | IPC 路径定义 |
| `hosts/windows/` | Windows 原生主机 C# 源码 |
| `hosts/macos/` | macOS 原生主机 Swift 源码 |

## 依赖

- **Node.js**: Claude Code 自带，无需额外安装（通过 `process.execPath` 运行）
- **Windows**: 预编译 exe 已内置（~1.8MB），需 .NET Desktop Runtime 8.0 或更高版本。大多数 Win10/11 已预装；若缺失：`winget install Microsoft.DotNet.DesktopRuntime.8`（50MB）
- **macOS**: 预编译二进制已内置（需 Xcode CLI Tools 编译，`xcode-select --install`）
- **WebView2 Runtime**: Windows 10+ 已内置，Win10 早期版本/LTSC 会自动下载

---

## /island 命令

用户通过 `/island` 与灵动岛交互。你需要根据参数执行相应操作。

**所有命令执行的脚本根目录**：先解析本 skill 文件所在目录（通常为 `~/.claude/skills/island/`），然后使用该目录下的 `bridge.mjs`。

### 0. 首次使用 — /island setup

**预编译的 exe 已内置在 skill 目录中**（`hosts/windows/island-host-win.exe`，约 1.8MB）。绝大多数用户不需要安装任何编译工具。

当用户第一次使用时，按以下步骤操作：

**步骤 1**: 检查预编译 exe 是否存在

Windows:
```powershell
Test-Path "$env:USERPROFILE\.claude\skills\island\hosts\windows\island-host-win.exe"
```
macOS:
```bash
test -f ~/.claude/skills/island/island-host-bin
```

**如果 exe 存在**（正常情况，skill 已内置），跳到步骤 3。

**如果 exe 不存在**（skill 源码安装、被误删等），按以下流程：

---

**步骤 2a**: 先检查 .NET Desktop Runtime（运行 exe 需要，不是 SDK）

Windows:
```powershell
dotnet --list-runtimes | Select-String "Microsoft.WindowsDesktop.App"
```
如果找到 `Microsoft.WindowsDesktop.App 8.x.x` 或更高版本（9.x、10.x 等）→ Runtime 已安装，跳到 2c。
如果找不到 → 引导用户安装（仅 50MB，不是 200MB 的 SDK）：
> 运行灵动岛需要 .NET Desktop Runtime 8.0 或更高版本。请安装：
> ```
> winget install Microsoft.DotNet.DesktopRuntime.8
> ```
> 安装完成后重新运行 `/island setup`。

**步骤 2b**: 如果 exe 和 Runtime 都没有，需要从源码编译（需要 .NET 8 SDK）

Windows:
```powershell
dotnet --list-sdks
```
如果找不到，告知用户：
> 编译灵动岛原生窗口需要 .NET 8 SDK。请安装：
> ```
> winget install Microsoft.DotNet.SDK.8
> ```
> 安装完成后重新运行 `/island setup`。

macOS:
```bash
swiftc --version
```
找不到则：
> macOS 上编译灵动岛需要 Xcode Command Line Tools。请安装：
> ```
> xcode-select --install
> ```

**步骤 2c**: 编译原生主机
```bash
node ~/.claude/skills/island/build.mjs
```

---

**步骤 3**: 初始化 bridge 状态

```bash
node ~/.claude/skills/island/bridge.mjs init
```

**步骤 4**: 配置 Claude Code hooks

读取 `~/.claude/settings.json`，将以下内容合并进去。

**重要**：Windows 上路径必须使用正斜杠 `/`（Node.js 原生支持），**禁止使用反斜杠 `\`**——反斜杠在 JSON 和 shell 多层转义中会被吃掉，导致路径错误。

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/skills/island/bridge.mjs prompt \"${PROMPT}\""
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/skills/island/bridge.mjs tool-start \"${TOOL_NAME}\" \"${TOOL_INPUT}\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/skills/island/bridge.mjs tool-end \"${TOOL_NAME}\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/skills/island/bridge.mjs done"
          }
        ]
      }
    ]
  }
}
```

**Windows 实际写入示例**（将 `~` 展开为绝对路径，使用正斜杠）：
```json
"command": "node C:/Users/zhangshuai18/.claude/skills/island/bridge.mjs prompt \"${PROMPT}\""
```

注意事项：
- 路径使用正斜杠 `/`，不用反斜杠 `\`（避免 JSON/shell 多层转义问题）
- 先读取现有 settings.json，合并 hooks 字段，**不要覆盖已有的其他 hooks**
- 如果已有同类型 hook，将 island 的 hook **追加**到数组末尾

**步骤 5**: 验证 hooks 格式正确

写入后立即检查——每个 island hook 条目必须包含 `hooks` 数组，且数组内每个元素有 `type: "command"`：

```bash
node -e "const s=require(process.env.HOME+'/.claude/settings.json'); for(const [k,arr] of Object.entries(s.hooks||{})){ for(const e of arr){ if(e.command&&!e.hooks){ console.log('BAD FORMAT in '+k+': missing nested hooks array. Expected: {matcher:\"...\", hooks:[{type:\"command\", command:\"...\"}]}'); process.exit(1); } } } console.log('OK');"
```

如果报 `BAD FORMAT`，说明写入格式错误，需要修复后重写。

**步骤 6**: 告知用户

> ✅ 灵动岛已配置完成！
> 现在可以使用以下命令：
> - `/island on` / `/island off` — 显示/隐藏
> - `/island toggle` — 切换显示
> - `/island scale <small|medium|large|xlarge>` — 调整大小
> - `/island reload` — 重启灵动岛
>
> 灵动岛会在 Claude Code 工作时自动在屏幕顶部显示状态胶囊。

### 1. /island on — 显示灵动岛

```bash
node ~/.claude/skills/island/bridge.mjs on
```

### 2. /island off — 隐藏灵动岛

```bash
node ~/.claude/skills/island/bridge.mjs off
```

### 3. /island toggle — 切换显示/隐藏

```bash
node ~/.claude/skills/island/bridge.mjs toggle
```

### 4. /island scale <size> — 调整大小

可选值: `small`, `medium`, `large`, `xlarge`

```bash
node ~/.claude/skills/island/bridge.mjs scale <size>
```

### 5. /island screen <value> — 选择屏幕

可选值: `primary`（主屏幕）、`active`（鼠标所在屏幕）、`1`、`2`、`3`...（指定第N个屏幕）

```bash
node ~/.claude/skills/island/bridge.mjs screen <value>
```

### 6. /island reload — 重启灵动岛

强制杀掉 companion 并重新启动（状态重置）:

```bash
node ~/.claude/skills/island/bridge.mjs reload
```

### 7. /island kill — 完全关闭

```bash
node ~/.claude/skills/island/bridge.mjs kill
```

### 8. /island status — 查看状态

```bash
node ~/.claude/skills/island/bridge.mjs status
```

输出当前状态（enabled、scale、project 等）。

---

## 故障排查

### 灵动岛不显示

1. 查看日志: `type %USERPROFILE%\.claude\claude-island.log` (Windows) 或 `cat ~/.claude/claude-island.log` (macOS)
2. 检查状态: `node ~/.claude/skills/island/bridge.mjs status`
3. 确保 enabled 为 true
4. 尝试 reload: `node ~/.claude/skills/island/bridge.mjs reload`
5. 手动启动 companion 看报错:
   ```bash
   node ~/.claude/skills/island/companion.mjs
   ```
   此时 stderr 会直接显示在终端中。

### 状态卡住 / 不更新

`/island reload` 会强制清理 companion 进程和残留状态。

### WebView2 初始化失败 (Windows)

确保 WebView2 Runtime 已安装。Win10 早期版本 / LTSC 可能需要手动安装:
https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### 窗口位置不对

- 检查屏幕检测是否正确: 查看 log 文件中的 `screenGeo` 行
- 尝试切换屏幕: `/island screen primary` 或 `/island screen active`
- 如果是多显示器，试用不同的屏幕编号: `/island screen 1`, `/island screen 2`

### companion 进程残留

```bash
node ~/.claude/skills/island/bridge.mjs kill
```
这会通过 PID 文件精确终止 companion 进程。如果 PID 文件丢失，会回退到进程名模式匹配。

---

## 行为说明

- **自动出现**: 当 Claude Code 开始执行操作时（PreToolUse hook），灵动岛自动显示状态行。
- **自动消失**: 操作完成 5 秒后，companion 自动移除状态行（不依赖 bridge 进程存活）。
- **多会话**: 每个 Claude Code 实例有独立的 sessionId，灵动岛会堆叠显示各行。
- **永久常驻**: companion 不会自动退出，灵动岛窗口在屏幕顶部持续显示。关闭需用 `/island kill`。
- **日志文件**: 位于 `~/.claude/claude-island.log`，最大 256KB，自动轮转。
- **偏好设置**: `~/.claude/claude-island.json`（enabled, scale, screen, notchMode）
- **会话状态**: `~/.claude/claude-island-state.json`（sessionId, project, inAgent 等运行时状态）
- **PID 文件**: `~/.claude/claude-island.pid`（用于精确进程管理）
