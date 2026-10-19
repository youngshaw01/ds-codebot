# M6 复盘 — 增量快照三项增强（持久化 / 内容哈希 / 文件监听）

日期：2026-10-19

## 总览

M5 复盘列出三个后续候选，本刀依次完成。三项都落在 `IncrementalWorkspace`，各自由 controller 的 `snapshotDir` 选项统一驱动（提供 → 持久化 + 监听；省略 → 纯内存 + 纯 stat，测试默认路径不变）。

## M6.1 快照持久化

- `flush()`：基线（路径 + stat + 内容/原因）序列化为 JSON 经 gzip 落盘，tmp + rename 原子替换；首次 `capture()` 时惰性加载，校验 `version`（v2）与 `root`，损坏/不匹配按冷启动。
- 验证：5 项单测——重启后已有文件零读取仅读新文件、gzip magic 与无 tmp 残留、损坏文件冷启动、root 不匹配丢弃、skipped 条目跨重启不重读。
- 边界：基线体积 = 工作区文本体积（gzip 后），仅放 globalStorage/state，永不进 workspace 快照（`state` 在 ignoreDirs）。

## M6.2 内容哈希

- 基线 file 条目增 `hash`（sha1）。**stat 仍是快路径**（读盘前最廉价的过滤，git 同款思路）；重读后以哈希校验：stat 变了但内容没变（touch、原子保存的邻居写入）→ 复用基线内容并刷新 stat，**不把无变化文件搅进 turn-diff**。
- 关键认知（记录在案）：**内容哈希不能消除"stat 未变但内容已变"的漏检窗口**——发现它必须读盘。该窗口由 M6.3 监听闭合。
- 验证：3 项单测——touch 触发重读但 diff 为空、真实变化正常更新、跨重启哈希仍抑制 touch 假阳性。

## M6.3 文件监听替代/增强 stat 轮询

- `chokidar` 监听工作区（ignoreInitial、ignoreDirs 同快照策略），事件入脏集；`capture()` 的读取候选 = **stat 不匹配 ∪ 脏标记**——listen 不是替代 stat 遍历（stat 是 O(1) syscall 的全量校验，遍历成本可忽略），而是补上 stat 分辨不出的事件。
- 监听器出错时静默退化为纯 stat 模式（`watcherActive` 可观测），正确性回落到 M5 语义，不致命。
- 验证：2 项单测——等大小 + mtime 还原的改写（纯 stat 必漏）被监听捕获并进入快照；ignoreDirs 内改动不产生脏标记。另 live-vscode 带 key 全路径复跑通过。

## 验收汇总

| 项 | 结果 |
|---|---|
| typecheck | 0 错误 |
| 无 key 全量 | 69/69 |
| live-vscode（真实运行时，M6 全路径：持久化 + 监听 + 哈希） | 1/1（7.2s，turn-diff 正确） |
| 回归（M1–M5 行为） | 全量套件内覆盖，无回退 |

## 缺陷清单

| # | 缺陷 | 状态 |
|---|---|---|
| 1 | 持久化测试把基线文件写进工作区（被 stat 遍历收录，readCount 断言失败） | 已修复：基线一律放 `state/`（ignoreDirs）——与 controller 真实布局一致 |
| 2 | 损坏基线测试写文件前未建 `state/` 目录（ENOENT） | 已修复：测试补 mkdir |
| 3 | `dispose()` 从同步改异步后调用方未 await | 已修复：extension deactivate 与 live 测试均 await |
| 4 | readCount 语义歧义（超限文件未读内容也计数） | 已修复：文档改为"进入读取路径的文件次数" |

## 已知限制（最终状态）

- 监听器存在理论漏报窗口（网络挂载/极端编辑器模式），此时回落到 M5 stat 语义——漏检仍可能，但比 M5 严苛场景更少。
- 持久化基线是进程退出时的完整镜像；崩溃时最多丢失上次 flush 后的增量（下次冷启动全读一次，无正确性影响）。
- 内容哈希只消除假阳性；假阴性（stat 未变）只能靠监听，纯 stat 路径下与 M5 相同。
