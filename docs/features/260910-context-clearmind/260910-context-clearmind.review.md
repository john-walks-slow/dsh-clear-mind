# 检视报告 — dsh-clear-mind（模型自主上下文压缩插件）

日期：2026-09-10 ｜ 检视人：reviewer 子代理 ｜ 对象：dsh-clear-mind 仓库全部新增文件

## 概要

对 dsh-clear-mind 的 8 个源文件、4 个测试文件、工程配置与文档做了全量检视，并将每一项平台契约（surfaceOp replace 语义、影子价格协议、compaction 事务词汇、锁规则、token-meter 折叠与 step 窗口、dsh-tools/dsh-skill/dsh-agent API、GUI 渲染路径）与 /usr/lib/node_modules/@deepseek-ai/dsh/ 的参考实现逐一比对到代码行。总体评价：**架构清晰、契约镜像度高、测试扎实**——事务序列（start→summary→replace→end 的邻接与 sourceEventSeqs 形状）、锁检测、fail-closed 收尾、tombstone 用 user/message notice 规避 step 窗口毒化，均与引擎等价或更稳健；单测用真实 Session 构造并做全日志影子价格断言，是高质量的测法。发现 **1 个阻塞问题**：checkpoint source 的 compactionId 与事务 compactionId 不一致，导致 GUI 压缩行降级为「压缩摘要不可用」、丢失条数/token 统计与可展开 notes，违反平台关联契约并打破计划的核心 UX 承诺。

## 需求对齐

- **功能完整交付**：mind_map（survey + 140 节点渲染上限 + turn 聚合）、clear_mind（哨兵端点、四事件事务、全量校验）、自折叠（无状态扫描 + prune/replace tombstone）、clear-mind 技能（触发信号/反信号/五段模板/防丢自检/注入防护/单独调用纪律）均按计划落地；config 四旋钮、README/AGENTS/docs（research/plan/summary/validation）齐备。
- **与计划的两处偏离均为改进且已记录**：① tombstone 从「空 assistant 擦除器」改为 user/message notice——这是 token-meter step 窗口约束（dsh-token-meter/lib/index.js:725-727 要求每个 assistant/message 匹配 step/start..step/end，违反即整个会话 replay 抛错）下的**必要**修正，且 user-role notice 是平台一等词汇（dsh-llm message.d.ts:82-84 `form:'notice'` + `summary`）；bracket-less prune+replace 也有平台先例（dsh-compaction-tool-result-pruner/lib/index.js:162-180）。② 计划的「pending collapse 登记」改为每步无状态扫描——崩溃安全、无状态漂移，更优。
- **未达成项（对应阻塞 B1）**：计划 §3.1 第 5 步与 §3.6「静态降级信任崩塌」护栏承诺的 GUI 原生「Compacted N items（可展开 notes）」行，因 compactionId 关联断裂而降级为不可展开、无统计的占位行（详见 B1）。validation.md 验证项 5 的预期（「GUI 会话视图显示检查点行(压缩视图)」）在当前实现下大概率不通过。
- **验证声明**：tsc 全绿、21/21 单测（我计数核对：scan 6 + commit 9 + collapse 6 = 21，相符）、E2E 六项结论与代码静态一致；但 E2E 断言全部停留在日志层，无 GUI 渲染层断言——这正是 B1 逃逸的原因。按检视纪律我未重跑测试/编译。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| B1 | src/commit.ts:186、196、241-249 | **checkpoint source 的 compactionId 与事务 compactionId 不是同一个**。commitClearMind 在 :196 为事务生成 `compactionId = CompactionId(randomUUID())`（用于 compaction/start/summary/end），但 :186 调用的 `frameCheckpointMessage(notes)` 在 :247 内部又自造了一个**新的** `randomUUID()` 塞进 `compactCheckpointSource`。平台契约要求 source 与事务关联（dsh-compaction/checkpoint.d.ts:26-32「correlated with one compaction transaction」），引擎实现把同一个 compactionId 传入 source（dsh-compaction-basic/lib/index.js:552-557）。GUI（dsh-client-ui-chat/lib/client.js:5576-5604）按 `source.compactionId === event.data.compactionId` 分组聚合 compaction 行：id 不匹配 → 生命周期事件组渲染为空，checkpoint 单独成组且 `compactSummary(undefined, checkpoint)` 得到 summary/shadowedItemCount/shadowedTokenCount 全 null（client.js:5448-5469），最终渲染为「上下文已压缩 — 压缩摘要不可用」的禁用行（client.js:166-171、2600-2604），无「已压缩 N 条历史记录（约 X tokens）」统计、无可展开 notes。现有测试只断言 `isCompactCheckpointSource`（仅查 kind/plugin，不查 id 关联），故未拦截。 | 把事务 compactionId 贯通到 checkpoint source：将 `frameCheckpointMessage(compactionId, notes)` 增加参数，commitClearMind 在 :196 之前（或同一处）生成 id 后传入；同步更新 `framedCheckpointTokens` 测试辅助。并在 commit 测试中断言 checkpoint 事件的 `source.compactionId === summary 事件的 data.compactionId`（补上逃逸的关联断言）。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| S1 | package.json（dependencies/devDependencies）；dist/src/index.js:19、dist/src/config.js:8；src/index.ts:23、src/config.ts:9 | **运行时 import 解析到 devDependencies**。构建产物有两处运行时依赖 devDep：`import "@deepseek-ai/dsh-skill"`（side-effect，dist/src/index.js:19）与 `import z from "@deepseek-ai/schemastery"`（Config 是导出的运行时值，dist/src/config.js:8）。link-package 模式（包内 node_modules 全量安装）下可运行（E2E 即此模式）；但 README 记录的 `pnpm add file:<本地仓库路径>` 安装路径只装生产依赖，两包不在插件自身 node_modules，ESM 解析失败会拖垮整棵 plugin tree——正是项目 AGENTS.md 记录的 link 坑的反向形态。平台惯例：dsh-compaction-basic 把 schemastery 放 dependencies。 | `@deepseek-ai/schemastery` 移入 dependencies；`@deepseek-ai/dsh-skill` 的 side-effect import 改为 type-only（`ctx.skills` 的类型来自模块增强，运行时服务由宿主插件树提供，无需副作用导入）或同样移入 dependencies。发布/安装前用目标安装方式实测一次插件树加载。 |
| S2 | src/collapse.ts:30、101-104、139-165 | **plan.provenance 是死代码，且其缺失守卫会无谓跳过折叠**。planCollapses 在 :101-104 读取被清 assistant 消息 source 的 provider/model，缺失即 `continue`；但 applyCollapse 从不使用 plan.provenance，compaction/prune 事件类型也没有 provider/model 字段。该守卫只增加了一个无收益的失败模式（若历史 assistant 消息缺 provenance，折叠被静默跳过）。 | 删除 provenance 字段与 :101-104 守卫（plan.stats/shadowedTokenCount 均不受影响）；或若本意是给 tombstone source 携带出处，则真正用起来并补测试。 |
| S3 | src/commit.ts:218-227 | **catch 注释与实际失败分支不符**。注释称「the surface was not replaced (the only mutating append is the checkpoint)」，但若错误发生在 compaction/end 追加（checkpoint replace 已成功），surface 已被替换且落下带 error 的闭合括号——语义上这是一次「已替换但标记为失败」的矛盾记录。引擎对同场景以 stage 区分（dsh-compaction-basic/lib/index.js:444-477：closing 前失败才补 error end，closing 后失败只记录不补）。 | 比照引擎引入 stage：仅在 checkpoint append 之前失败时补 `compaction/end {error}`；replace 已落地后的 end 失败按引擎语义处理。至少先修正注释，不再声称「surface 未被替换」。 |
| S4 | test/commit.test.ts | **fail-closed 错误路径零覆盖**。compaction/end {error} 的 best-effort 收尾是「括号不闭合即会话永久无法加载」的唯一防线（AGENTS.md 契约 4），但没有任何测试触发过 catch 分支。 | 补一个注入式失败测试：包装 session.append 使第 N 次调用抛错（分别覆盖 summary 阶段与 end 阶段），断言恰好一个 `compaction/end {error}`、括号闭合、原错误向上抛出。 |
| S5 | src/index.ts:70-82；src/collapse.ts:73-122 | **自折叠扫描对每个 agent（含子代理）每步全量执行**。pre-step 监听在根 ctx 上注册，所有 agent 的每一步都会扫描其整个 surface；子代理不可能注册 clear_mind（root-only），扫描纯属浪费（长会话多子代理时每步 O(surface)×agent 数）。 | 复用 index.ts 已有的 `registered` WeakSet（或单独维护）过滤：仅对注册过 clear_mind 的 agent 执行 collapseClearMindRuns；或在 planCollapses 前置一个廉价的「surface 中是否存在名为 clear_mind 的 tool-call」快检。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| N1 | src/scan.ts:110-113 | isCheckpointSource 手写复刻了平台 `isCompactCheckpointSource`（kind/plugin 判定），与 commit.ts 已导入的 compactCheckpointSource 形成两处定义，未来可能漂移。 | 直接 import 平台 `isCompactCheckpointSource`。 |
| N2 | src/render.ts:64-84 | lockstep 渲染中，turn 为 null 的前置节点会把 turnIndex 推到末尾，导致其后第一个真实 turn 不打印 turn 头（仅外观问题；正常会话 surface 节点都在 turn 内，罕见）。 | 遇到 null-turn 节点不推进 turnIndex（例如先跳过 null 再定位），或接受现状并注释。 |
| N3 | src/render.ts:35-38 | 聚合旧行的 ▸/◂ 标记是按 turn 首尾无条件标注，未携带 scan 的真实 validStart/validEnd（commit 会复查，模型最多多一次被拒的重试）。 | SurveyTurn 带 `validStart/validEnd`（取该 turn 首尾节点的真实值），turnLine 按实际值打标。 |
| N4 | src/commit.ts:187-192 | 「检查点必须更小」采用路由计价优先、启发式兜底；引擎是纯路由比较（route 为 0 时必拒）。差异是有意的（Changes 已注明），但代码内无注释，未来引擎对齐时易被误当 bug。 | 在该处加两行注释说明与 compactSurfaceRegion 的差异及理由。 |
| N5 | src/skill.ts:53-55 | 失败的 clear_mind（校验拒绝）不折叠（正确），其 notes 参数（最长 16k 字符）会常驻 surface；skill 只给了混批补救话术，未提失败残留的清理。 | 在 skill 第 3.e 步或「原则」段补一句：失败的 clear_mind 参数残留可在下次成功清理时随区间一并清除。 |
| N6 | package.json（files） | files 含 `LICENSE` 但仓库无该文件；发布打包时会缺失（npm 不报错但产物不完整，且 license 字段声明 MIT）。 | 补 LICENSE 文件或从 files 移除；发布前 `npm pack --dry-run` 核对产物。 |

## 准入结论

**结论**：`不准入`

**说明**：仅 B1 一项阻塞——checkpoint source 与事务 compactionId 断裂，违反平台关联契约并使 GUI 压缩行降级为「压缩摘要不可用」，直接打破计划 §3.1/§3.6 的核心信任 UX 与 validation 项 5 的预期。修复极小（贯通一个 UUID + 补一条关联断言），建议与 S1（README 安装路径下的依赖解析）同批处理后复检；其余实现质量高，复检可聚焦 B1/S1 回归与新增断言。
