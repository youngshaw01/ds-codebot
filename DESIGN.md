# ds-codebot 详细设计

> 基于 deepseek-harness 的编码机器人框架。本文档是架构决策与模块契约的唯一来源。
> 协议事实以 `@deepseek-ai/dsh-sdk-protocol` / `@deepseek-ai/dsh-sdk-client` 当前版本为准。

## 1. 目标与范围

**v1 目标**：一个自有"编码机器人"框架——同一套 agent 驱动核心（`BotCore`），挂不同前端：先是 TUI，后续飞书 bot、VS Code 扩展。

**明确不做**：

- 不改 deepseek-harness 仓库、不 fork、不实现自己的模型协议。
- 所有 agent 能力（模型、工具、沙箱、审批、会话持久化、上下文压缩）全部委托 `dsh --profile sdk` 运行时。
- 不做权限协商 UI（协议不支持，见 4.4）。

## 2. 总体架构

```
ds-codebot (自有仓库, Node/TS)
┌──────────────────────────────────────────────┐
│  frontend:TUI   frontend:Feishu   frontend:VSCode │
│       └──────────────┬───────────────────┘    │
│                      ▼                        │
│           ┌─────────────────────┐             │
│           │ BotCore (编排层)     │             │
│           │  - SessionRegistry   │ 外部会话↔session 映射 │
│           │  - RuntimePool       │ dsh 子进程生命周期    │
│           │  - EventRouter       │ event→前端事件       │
│           └──────────┬──────────┘             │
└─────────────┼────────┼───────────────────────┘
              │ JSON-RPC (newline-delimited, stdio)
              ▼
     ┌────────────────────────┐
     │ dsh --profile sdk      │ 独立安装的同版本运行时
     │ 模型/工具/沙箱/审批/持久化│
     └────────────────────────┘
```

前端只做"输入 + 渲染"，不碰协议细节；所有 agent 交互收敛到 `BotCore`。

## 3. 仓库结构

```
ds-codebot/
├─ package.json            # deps: @deepseek-ai/dsh-sdk-client, @deepseek-ai/dsh-llm(类型), ink(TUI)
├─ src/
│  ├─ core/
│  │  ├─ runtime.ts        # DeepSeekHarness 封装: 启动/握手/重连/teardown
│  │  ├─ registry.ts       # 会话注册表: 外部会话id → sessionId (+ cwd, 元数据)
│  │  ├─ router.ts         # session.event 分发到订阅的前端
│  │  └─ errors.ts         # 四类 wire 错误 → 用户可见行为映射
│  ├─ frontends/
│  │  ├─ tui/              # M1: ink 渲染 + readline 输入
│  │  ├─ feishu/           # M3: 事件回调/长连接客户端(自建)
│  │  └─ vscode/           # M4: spawn + webview 渲染
│  └─ index.ts             # CLI 入口: ds-codebot tui | feishu
└─ state/                  # 会话映射持久化(json), gitignore
```

## 4. 核心模块设计

### 4.1 RuntimePool（运行时生命周期）

- 每个 dsh 子进程 = 一个 `HarnessClient`。起步用 `DeepSeekHarness` 高层 API，协议摸熟后按需下沉到 `HarnessClient`（`subscribe` / `tryNext` / `request`）。
- 启动参数：`profile: 'sdk'`、`patches: [...]`（自定义权限/沙箱层）、`provider`/`model`/`reasoningEffort`/`maxTokens`，均来自配置文件。
- **握手语义**：`initialize` 会校验 provider/model 路由，失败时后续 `session/prompt` 一律被拒绝。因此配置错误必须在启动时 fail loud，不能等用户发消息。
- 可执行文件严格使用"同版本解析"（client 默认解析同版本 `@deepseek-ai/dsh`）；升级策略 = 升级本仓 package.json 中的 dsh 相关依赖，两端版本必须对齐。

### 4.2 SessionRegistry（会话映射）

```ts
type Binding = {
  externalKey: string   // TUI: 'local'; 飞书: chat_id; VSCode: 工作区 uri
  sessionId: string     // dsh session
  cwd: string
  createdAt: number
}
```

- 持久化到 `state/registry.json`。dsh 侧负责 session 的持久化与恢复，客户端只需记住 id，因此重启后飞书群会话可续聊。
- **并发**：同一 `externalKey` 的 prompt 在客户端串行化（FIFO）；不同 key 共享一个 runtime 通知流，靠 `sessionId` 过滤。

### 4.3 EventRouter（事件分发）

协议提供 4 个 server→client 通知：

| 通知 | 语义 | 前端处理 |
|---|---|---|
| `session.event` | **所有 session、不过滤**推送 | client 侧按 sessionId 过滤后分发 |
| `session.status` | 整机 `running`/`idle` | "正在思考…"指示器、批量回复触发 |
| `subagent.started` / `subagent.finished` | 子代理生命周期（仅进程内运行） | "派生子任务中"展示 |

渲染素材全部来自 `session.event` 中的持久事件（`user/message`、`assistant/message`、`tool/call`、`tool/result`、`turn/start`、`turn/end`）。这是 dsh "model-visible ⟺ logged" 原则的免费礼物：**前端无需额外状态机，重放事件即可完整重建界面**。

### 4.4 三个必须设计的协议约束（真实坑）

1. **没有 cancel 方法**。放弃一轮 = 关闭 runtime 进程。对策：TUI 的 Ctrl-C 不发送取消，只把该 session 标记为 abandoned（runtime 可继续跑完，或直接 kill 整个 runtime）；飞书"停止"按钮同理。v1 向用户明示此限制。
2. **审批无法走 wire**（server→client requests 是 dead capability，永不发送）。bot/TUI 场景必须**预配置权限**：通过 `patches` 挂 `permissionPresets`（如 `workspace-write` + 沙箱；个人玩具场景可 `danger-full-access`），否则审批缺应答者会 fail-closed，工具调用直接被拒。
3. **通知是全局流**：多会话并发时必须严格按 sessionId 与 subagent lineage 边界过滤，否则飞书 A 群会收到 B 群的输出。

### 4.5 错误处理矩阵

| wire 错误 | 场景 | 用户可见行为 |
|---|---|---|
| `TransportClosedError` | dsh 子进程崩溃/被杀 | 提示"运行时已断开"，registry 标记该 session 为 stale |
| `RequestTimeoutError` | initialize/prompt 超时 | 启动期输出配置诊断；运行期提示模型/网络问题 |
| `JsonRpcResponseError` | 路由非法、模型不可用 | 直接呈现 wire `data`（启动已 fail loud，运行期少见） |
| `SdkProtocolError` | 客户端/运行时版本不匹配 | 提示版本对齐 |

## 5. 配置设计

```jsonc
// ds-codebot.config.json
{
  "runtime": {
    "profile": "sdk",
    "patches": ["./patches/safe.cordis.yml"],
    "provider": "deepseek-official",
    "model": "deepseek-v4-flash",
    "reasoningEffort": "medium",
    "maxTokens": 49152
  },
  "tui": { "defaultCwd": "." },
  "feishu": { "appId": "...", "appSecret": "..." }
}
```

- 配置文件中不出现任何 secret；飞书凭据等一律走环境变量。
- 凭据策略：client 支持 `env` 整体替换子进程环境。需要隔离时以 `dsh-subprocess` 的 `scrubbedParentEnv` 为基底，个人本地使用可继承父环境。
- `state/registry.json` 加入 `.gitignore`。

## 6. 里程碑

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| M1 driver | `RuntimePool` + 单 session `session/prompt` → `session/wait` → 打印 `finalResponse` | CLI 连续对话 3 轮；Ctrl-C 触发安全 teardown（stdin-EOF → SIGTERM → SIGKILL 由 client 负责） |
| M2 TUI | `EventRouter` + ink 流式渲染；`/cwd` 命令走 `session/working-directory/set`；turn 状态指示 | 可观察 tool_call 过程；切换目录后会话连续 |
| M3 飞书 | 自建事件客户端 + `SessionRegistry` 映射 + 全局流按 sessionId 路由 | 群内 @bot 执行编码任务；同一群上下文连续 |
| M4 VSCode（可选） | spawn SDK 子进程 + webview 复用 EventRouter | 工作区绑定会话；diff 展示 |

## 7. 测试策略（自定，轻量）

- `runtime.ts`：真实 spawn `dsh --profile sdk` 跑一次 echo 对话（e2e，无 `DEEPSEEK_API_KEY` 时 skip）。
- `router.ts`：回放录制的 `session.event` JSONL，断言前端收到正确的过滤结果（借鉴 dsh 的 snapshot 测试思路）。
- 每个 frontend 一个冒烟测试。

## 8. 设计中最值得先理解的三件事

1. `session/prompt → session/wait → idle` 的 activity interval 语义：prompt 返回的是入队回执，不是结果；结果区间以整机 idle 收口，且 `finalResponse` 是区间内最后一条 root assistant 文本，不与单次输入因果绑定。
2. 通知是全局流，session 边界过滤是客户端自己的责任。
3. 审批不走 wire，权限必须在启动配置里预置——这决定了 bot 类产品的整套安全姿态。
