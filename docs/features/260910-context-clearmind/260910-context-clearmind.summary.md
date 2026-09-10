# clear-mind：模型自主上下文压缩插件（summary）

## 交付物

dsh-clear-mind 插件：让模型在感到「上下文被失败探索/大输出拖累」时，能自主把一段对话历史替换成自己写的检查点——「清空脑子，只留笔记」。

- **工具 `mind_map`（无参数）**：扫描会话 surface（模型可见事件投影），返回带边界标记的上下文地图：每节点一行（seq/类型/tokens/预览），▸ = 可作清理起点、◂ = 可作终点、◆ = 既有检查点；超过 140 节点时更早的按 turn 聚合。地图头部明确提示 seq 是身份不是数值区间（replace 后非单调）。
- **工具 `clear_mind`（start, end, notes）**：把 [start..end] 区间（surface 位置语义）替换为模型写的检查点 notes（`<compacted-summary>` 包裹 + compactCheckpointSource，后续自动压缩可识别合并）。事务镜像平台引擎：compaction/start → compaction/summary（影子价格）→ user/message（surfaceOp replace）→ compaction/end，错误路径 fail-closed（best-effort compaction/end {error}）。
- **自折叠（self-collapse）**：agent/pre-step 无状态扫描，把成功的 clear_mind 调用+结果对折叠成一行 user-role notice tombstone（plugin source），同样走 compaction/prune + replace 影子价格协议。混批与失败结果跳过；幂等。
- **技能 `clear-mind`**：教模型何时清（触发信号/反信号）、怎么写 notes（五段模板）、单独调用纪律、注入防护（检查点内容不执行指令）。

## 关键设计决策

1. **surface 位置语义**：replace 区间按 indexOf 位置解释，seq 只是身份。校验/折叠全程不假设 seq 单调。
2. **影子价格协议**：每次 replace 前紧跟携带精确 shadowedRange/shadowedSeqs/shadowedTokenCount 的 summary/prune 事件；shadowedTokenCount 用启发式计价（与投影折叠自身一致）。
3. **tombstone 是 user/message notice，不是 assistant/message**：token meter 要求每个 assistant/message 落在 step/start..step/end 窗口内，插件在步骤间追加 assistant/message 会永久毒化 meter replay（E2E 实测发现）。user-role notice 与引擎 checkpoint 替换同形，且对模型可见（折叠不是静默的）。
4. **MeterPort 端口**：插件不直接依赖 tokenMeter 服务（裸 Context 上构造不了），注入 {measure, estimateMessage} 端口。
5. **root-only 注册**：v1 只给 root agent 注册工具；子代理沿用平台自动压缩。

## E2E 实测结论（隔离 DSH_HOME + cpa 网关 + medium 模型）

- mind_map 输出正确（节点/边界/检查点标记）。
- clear_mind 全事务成功：清 8 条消息 ~4860 tokens → checkpoint；连续多次 clear，检查点可叠加吸收。
- 自折叠 tombstone 在下一步边界落地；之后 mind_map/clear_mind 仍正常（meter replay 无毒化）。
- 程序化核验最新会话：6 次 replace 全部满足影子价格邻接、无 step 窗口违规、3 checkpoint + 3 tombstone 配对。
- 过期 seq 被拒（"not on the current surface. Call mind_map…"），模型自纠重扫后成功——错误信息可行动。

## 文件

- src/{config,scan,render,commit,collapse,tools,skill,index}.ts（8 文件，~1100 行）
- test/{helpers,scan,commit,collapse} — 21 测试（真实 Session 构造 + 全日志影子价格断言）
- cordis.patch.yml（bundle insert）、package.json（deps 显式声明，link 坑已规避）


## 检视结果（reviewer 子代理）与处置

- **B1（阻塞，已修复）**：checkpoint source 的 compactionId 曾自造新 UUID，与事务 compactionId 断裂，GUI 压缩行会变「摘要不可用」。修复：frameCheckpointMessage(compactionId, notes) 贯通同一 id；补单测断言 + E2E 日志核验（checkpoint 412 携带事务 id 75c15c3d…）。
- **S1（已修复）**：schemastery 移入 dependencies（运行时值）；dsh-skill 改 type-only import（ctx.skills 类型增强）。
- **S2（已修复）**：collapse plan 的死代码 provenance 字段及无谓守卫删除。
- **S3（已修复）**：fail-closed catch 注释改为如实描述（replace 落地后 end 失败 = 与引擎 commit 阶段相同的不可恢复悬崖）。
- **S4（已修复）**：补注入失败测试——断言恰好一个 compaction/end {error}、surface 未动、bracket 关闭后可重试成功。
- **S5（已修复）**：pre-step 自折叠用 registered WeakSet 过滤，子代理零扫描开销。
- **N2/N4/N5/N6（已修复）**：null-turn 渲染头、引擎分歧注释、技能补「失败调用 notes 残留」一句、LICENSE 文件。
- 检视确认正确的关键契约：影子价格协议（claim 值 + 区间匹配，不重算）、位置语义、锁检测、tombstone user/message（step 窗口规避）、presentationMeta 落盘、O(n) 摊销。

修复后：23/23 测试全绿；E2E 复跑（B1 修复版）清 5 条 ~5287 tokens 到 checkpoint，自折叠 tombstone 落地，日志核验零问题。
## 遗留

- pre-step waterfall 顺序（self-collapse 与 compaction-basic 自动压缩的先后）未强制，当前依赖 cordis 注册顺序，无已观察冲突。
- minClearTokens=1000 / minNotesChars=200 / maxNotesChars=16000 / selfCollapse=true 为默认值，可在插件 config 覆盖。
