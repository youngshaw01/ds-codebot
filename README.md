# ds-codebot

基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的编码机器人框架：同一套 agent 驱动核心（BotCore），挂不同前端（TUI / 飞书 bot / VS Code 扩展）。

所有 agent 能力（模型、工具、沙箱、审批、会话持久化、上下文压缩）委托 `dsh --profile sdk` 运行时完成；本仓库只做协议编排与前端渲染，不改动 deepseek-harness 本身。

## 目录边界

| 目录 | 内容 | 是否进 git |
|---|---|---|
| `.harness/` | 规范、设计与决策文档（见 `.harness/README.md`） | 是 |
| `src/` | 可执行代码 | 是 |
| `state/` | 运行时状态（如会话映射 `registry.json`） | 否 |

设计、协议约定、里程碑等文档统一存放于 `.harness/`，与代码目录严格分离。

## 文档

- [详细设计](.harness/DESIGN.md) —— 架构、模块契约、协议约束、里程碑
- [规范索引](.harness/README.md) —— `.harness/` 全部规范文档目录

## 路线图

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | driver：`RuntimePool` + 最小 CLI（prompt → wait → 打印结果） | 未开工 |
| M2 | TUI 前端（ink 流式渲染、`/cwd`、turn 指示） | 未开工 |
| M3 | 飞书 bot（事件客户端、会话映射、全局流路由） | 未开工 |
| M4 | VS Code 扩展后端（可选） | 未开工 |

## 快速开始

```sh
npm install
export DEEPSEEK_API_KEY=<你的 key>   # 仅真实模型调用需要；启动与握手不需要
npm start                            # 等价 npx tsx src/index.ts
```

启动后输入任务回车，等待回复；空行或 Ctrl-C 退出。`--config=<路径>` 指定配置文件（默认 `ds-codebot.config.json`）。

TUI 模式（ink 全屏界面，工具调用实时可见、`/cwd` 切目录、状态栏显示运行状态）：

```sh
npm run tui    # 需要真实 TTY 终端；管道/CI 环境会 fail-loud 并指引回 CLI 模式
```

当前进度：M1–M4 全部完成（复盘见 `.harness/milestones/`）。M3 真实飞书租户联调、M4 真实 VS Code 宿主联调待首跑。

### VS Code 扩展

```sh
npm run build:vscode    # esbuild 打包到 dist-vscode/（单文件 CJS + 扩展清单）
code --extensionDevelopmentPath=dist-vscode   # 扩展开发宿主中加载
```

命令面板执行 `ds-codebot: 打开编码助手`：绑定当前工作区文件夹 ↔ session，对话与工具调用实时渲染，每轮结束后推送工作区 `turn-diff`（宿主侧快照 + 行差分）。输入框支持 `/cwd <目录>`。注意：审批交互无法经 SDK wire 传递，权限须在 `ds-codebot.config.json` 的 patch 层预置。

### 飞书 bot

```sh
export FEISHU_APP_ID=<飞书应用 App ID>       # 只走环境变量
export FEISHU_APP_SECRET=<飞书应用 App Secret>
export DEEPSEEK_API_KEY=<你的 key>
npm run feishu
```

前置：飞书开放平台创建企业自建应用 → 启用「机器人」→ 订阅 `im.message.receive_v1` 事件（长连接模式）→ 申请 `im:message` 发送权限。群内 @bot 或私聊发送任务；`/cwd <目录>` 切换工作目录，`/new` 重置会话，`/help` 帮助。会话映射持久化在 `state/feishu-registry.json`，重启后续聊。

## 开发

需要 Node ^22.19 或 >=24，以及独立安装的 deepseek-harness `dsh` CLI（SDK 客户端按版本解析同版本运行时）。真实 API 调用读取 `DEEPSEEK_API_KEY`，凭据一律走环境变量，不落库。
