# 灵动岛 (Dynamic Island) for Claude Code

一个 Claude Code 的 **skill**，在屏幕顶部显示桌面级灵动岛风格的状态胶囊，实时展示 Claude Code 当前工作状态。

- **macOS**: 利用 MacBook 刘海区域，原生 Cocoa + WKWebView
- **Windows**: 屏幕顶部居中胶囊，WinForms + WebView2

## 效果预览

当 Claude Code 工作时，屏幕顶部会出现一个半透明的黑色胶囊，显示当前操作状态（如"正在读取文件..."、"执行命令中..."等），操作完成后自动消失。

## 安装

将此 skill 目录放置到 `~/.claude/skills/island/`，然后在 Claude Code 中输入：

```
/island setup
```

Agent 会自动完成环境检查、依赖安装、编译和 hooks 配置。

## 依赖

| 依赖 | 用途 | 安装方式 |
|------|------|---------|
| **Node.js** | 运行所有 JS 脚本 | Claude Code 自带 |
| **.NET Desktop Runtime 8.0+** | Windows：运行预编译 exe | `winget install Microsoft.DotNet.DesktopRuntime.8` |
| **WebView2 Runtime** | Windows：渲染胶囊 HTML | Windows 10+ 已内置 |

预编译 exe 已内置在 `src/hosts/windows/` 目录中，绝大多数用户无需安装编译工具。

## 命令

| 命令 | 说明 |
|------|------|
| `/island setup` | 首次初始化，自动配置环境与 hooks |
| `/island on` | 显示灵动岛 |
| `/island off` | 隐藏灵动岛 |
| `/island toggle` | 切换显示/隐藏 |
| `/island scale <small\|medium\|large\|xlarge>` | 调整大小 |
| `/island screen <primary\|active\|1\|2\|...>` | 选择屏幕 |
| `/island reload` | 重启灵动岛 |
| `/island kill` | 完全关闭 |
| `/island status` | 查看状态 |

## 架构

```
Claude Code hooks (settings.json)
  ↓ SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop
bridge.mjs  (一次性进程，每次 hook 调用)
  ↓ Named pipe / Unix socket
companion.mjs  (常驻守护进程)
  ↓ stdin/stdout JSON-line 协议
原生窗口 (Swift/C# WebView)
  └─ 渲染透明背景黑色胶囊 HTML
```

## 行为

- **自动启动**: Claude Code 启动时灵动岛自动出现
- **自动消失**: 操作完成 30 秒后状态行自动移除
- **多会话**: 每个 Claude Code 实例独立显示
- **永久常驻**: companion 不会自动退出，需手动 `/island kill`
- **重启恢复**: 电脑重启后下次打开 Claude Code 自动恢复

## 故障排查

详见 `SKILL.md` 中的故障排查章节，或输入 `/island status` 查看运行状态。

## 许可

MIT
