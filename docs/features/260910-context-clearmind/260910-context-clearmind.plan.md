# dsh-clear-mind：模型自主上下文压缩插件

日期：2026-09-10 ｜ 状态：计划已定稿，待实施

## 0. 一句话

给 DSH 里的模型两个工具（`mind_map` 俯瞰自己的上下文、`clear_mind` 把一段历史替换成自己写的检查点）+ 一个 `clear-mind` skill（教模型在什么时候、以什么流程清理自己的脑子）。压缩是即时的（无辅助 LLM 调用）、对人类完全可逆（事件日志不变、GUI 原文可见）。

## 1. 背景与差异化

DSH 已有两条压缩路径，都不满足"模型自主、按语义区间"这个需求：

| 现有能力 | 触发 | 区间 | 摘要来源 |
|---|---|---|---|
| compaction-basic 自动压缩 | token 阈值（80%）或 context overflow | 头部锚定 + 保留近期尾巴（比例/绝对值） | 辅助 LLM 调用（重放前缀复用 KV cache） |
| /compact 命令 | 用户手动 | 同上 | 同上 |

**缺口**：模型走了两小时弯路、试错堆积、历史支线已完成——此时"近期尾巴"恰恰是弯路本身，自动压缩保不住语义边界。业界调研（见同目录 research 报告）确认：Claude Code / Codex / Gemini CLI / Cline / OpenClaw / OpenHands 等主流实现全部是阈值自动或用户手动，**"模型自主发起 + 语义区间 + 检查点替换"组合无先例**——这是本插件的差异化价值。

## 2. 平台机制调研结论（代码级）

以 `/usr/lib/node_modules/@deepseek-ai/dsh/` 实际代码为准（0.1.2-rc.1）：

- **Session = append-only 事件日志 + surface（模型可见表面）**。surface 只含 `user/message`、`assistant/message`、`tool/result` 三类事件（`session.surface.nodes` = 有序 seq 数组）；`session.deriveMessages()` 每步从 surface 现算请求消息。
- **surface 区间替换是平台一等能力**：`session.append("user/message", msg, {surfaceOp: {op:"replace", start, end}, sourceEventSeqs})`。"any surface-replacing producer may use it"（dsh-session surface.d.ts）。被替换节点仍在日志中（GUI 人类 transcript 用 append-origin 事件渲染，不受替换影响）。
- **shadow-price 协议**（token-meter O(1) 投影）：每次 replace 前必须紧邻追加 `compaction/prune`（无 LLM 路径）或 `compaction/summary`（LLM 路径）事件，携带 `shadowedRange/shadowedSeqs/shadowedTokenCount`（heuristic 估算价，= `ctx.tokenMeter.estimateMessage` 之和）。违反会导致持久化投影漂移。
- **compaction 事务词汇**（dsh-compaction types.d.ts）：`compaction/start`（锁）→ `compaction/summary` → 替换消息 → `compaction/end`。GUI conversation 原生渲染 compaction row：识别 `compaction/summary` 事件 + 带 `{kind:"plugin", plugin:"compact", compactionId}` source 的替换 user/message（`compactSource()`），按 compactionId 聚合成"Compacted N items (~X tokens)"可展开行。
- **工具配对平衡**：区间端点不能拆开 tool-call/result 对（`toolPairingBalancedBefore/After(session, seq)`，dsh-compaction 导出）。当前 in-flight 步骤（未闭合的 tool-call）天然不可被包含——自带安全。
- **工具注册**：`ctx.tools.register(defineTool({...}))`（dsh-tools）；`exec.agent` 给出调用方 agent（→ agent.session）。不声明 `isConcurrencySafe` 即 exclusive（同 step 内与其他工具串行）。
- **事件类型是封闭集合**（KNOWN_SESSION_EVENT_TYPES）：插件不得发明新类型（除非 ignorable，那会丢可观测性）。本插件完全复用 compaction/* + user/message + assistant/message。
- **空 content assistant/message 派生为 null**（不可见节点，0 token）——dsh-proactive 已用它做"擦除器"（eraser）。
- **runtime skill 注册**：`ctx.skills.register({name, description, content, invocation?})`——无需文件系统，插件自带 skill。
- **agent/pre-step**：每步 LLM 请求前触发（waterfall 串行）；compaction-basic 的自动压缩也挂在这里，与本插件自折叠监听天然串行化。
- **dsh-headless**：`dsh --profile <p> "<task>"` 一次性任务 → stdout 出结果 → 退出；配合隔离 DSH_HOME 可做真实模型 E2E。

## 3. 设计

### 3.1 用户（模型）路径

1. 模型感觉脑子乱/弯路结束/阶段切换 → 读 `clear-mind` skill（目录里的触发词足够让模型想起来）。
2. skill 教它：反思 → 外化（todo/memory/文件）→ 压缩 → 聚焦。
3. 压缩 = 先 `mind_map`（拿到 seq 地图与合法切点），选区间，按模板写 notes，自检防丢，然后 `clear_mind(start, end, notes)`。
4. 工具即时提交事务，返回清理报告；下一步边界处 clear_mind 调用本身自抹除。
5. 模型重述目标继续工作。GUI 里用户看到一条"Compacted N items"行（可展开看 notes）。

### 3.2 工具 API

**`mind_map()`**（无参数，只读，exclusive）
- 输出（render，即模型所见）：总览行（surface 节点数、heuristic tokens、请求压力 tokens、latest 可清端点 seq）+ 按 turn 分组的逐节点行：
  `▸ seq ◂ kind tokens "preview"`（▸=合法起点，◂=合法终点，◆=既有检查点，tool 行带工具名）。
- value（结构化）：`{kind:"survey", surfaceNodes, surfaceTokens, requestPressureTokens, latestEndSeq, turns:[{turn,startSeq,endSeq,tokens,nodes}], checkpoints:[seq]}`（GUI/程序用，省 per-node 明细；render 才是模型通道）。

**`clear_mind({start, end, notes})`**（exclusive）
- `start`: number（seq）或 `"first"`；`end`: number（seq）或 `"latest"`（= 当前 in-flight 步骤前的最后一个平衡边界）。
- `notes`: string——检查点正文（skill 教模板；工具只做长度护栏）。
- 校验（全部返回可操作错误而非抛异常）：
  - seq 存在于当前 surface、start ≤ end、端点配对平衡（不平衡时报最近合法端点）；
  - 被 清区间 heuristic tokens ≥ minClearTokens（默认 1000，防无意义小清理）；
  - notes 长度 ∈ [minNotesChars(200), maxNotesChars(16000)]；
  - 框装后检查点 tokens < 被清 tokens（摘要必须更小）。
- 成功 value：`{kind:"cleared", clearedNodes, clearedTokens, checkpointSeq, surfaceTokensBefore, surfaceTokensAfter, selfCollapse}`。

### 3.3 提交事务（同步、四事件、紧邻）

```
compaction/start  {compactionId: uuid, turn: <当前开放 turn>}      // 与引擎同形；同步闭合，锁不被观测
compaction/summary {compactionId, summary: [notes 文本块], shadowedRange, shadowedSeqs,
                    shadowedTokenCount, provider, model}            // 武装 shadow-price claim
user/message      {content: preamble+<compacted-summary>notes</compacted-summary>,
                   source: compactCheckpointSource(compactionId)}   // surfaceOp replace + sourceEventSeqs=[start,summary,...shadowed]
compaction/end    {compactionId, turn}
```

- provider/model 取会话 requestHeader（当前步路由）→ agent.options 兜底——语义真实（摘要确由该模型写成，写在 tool-call args 里）。
- `<compacted-summary>` 标签与平台 auto-compaction 的检查点标记一致：未来自动压缩会把本检查点当 prior checkpoint 合并而非重复摘要。
- 检查点 preamble：声明这是 clear-mind 检查点、当作既定背景、不要复述、从后续消息继续。
- 全程同步（无 await），无稳定性竞态；不像引擎那样需要 whole-surface 稳定断言。

### 3.4 自折叠（self-collapse）

问题：notes 作为 clear_mind 的 tool-call 参数会留在 surface（该调用本身不可被清——in-flight）。不处理则 notes 双份常驻。
方案：提交时登记 pending collapse（sessionId → {assistantSeq, callId}）；监听 `agent/pre-step`，在下一步请求前：
- 守卫：assistantSeq 仍在 surface；该 assistant message 只含这一个 tool-call；紧随其后的 surface 节点就是本调用的 tool/result。
- 满足则：`compaction/prune`（shadow price）+ 空 content `assistant/message` 擦除器 replace [assistantSeq, resultSeq]（派生 null，0 token，proactive 同款模式）；provider/model 取被清 assistant 消息的 provenance。
- 不满足（模型把 clear_mind 和别的工具混在一个消息里调用等）→ 跳过并 log，只留轻微冗余，无正确性风险。
- 与 compaction-basic 的 pre-step 自动压缩串行（waterfall 注册序），对方若先清掉本区间则守卫自然跳过。

### 3.5 clear-mind skill（runtime 注册，中文）

内容骨架：什么时候用（6 个信号）/ 什么时候不用（3 个反时机）/ 工作流（反思→外化→压缩→聚焦）/ notes 五节模板（任务与用户意图原话、关键事实与决策逐字、已放弃路径防重试、未决事项、下一步）/ 提交前防丢自检（用户未完成要求、后续要用的标识符、"不要做 X"约束——针对 Lost in Compaction 的 17% 约束幸存率风险）/ 原则（宁清勿攒、检查点是移交文档、人类侧可逆所以大胆清）。

### 3.6 护栏汇总（对应调研 §6 风险）

| 风险 | 护栏 |
|---|---|
| 约束/关键信息丢失 | skill 模板 + 提交前自检清单；检查点标签让 auto-compaction 可合并 |
| 静默降级信任崩塌 | GUI 原生 compaction row（可见、可展开 notes）；工具返回明确前后 token 报告；模型收到显式确认文本 |
| 压缩死循环烧配额 | 本插件零 LLM 调用（无配额成本）；minClearTokens 地板阻断琐碎循环 |
| 压缩打断任务 | 只能清到当前步骤之前（配对平衡天然强制）；skill 教保留近期 verbatim 尾巴 |
| 摘要生成失败 | 不存在——notes 由模型自己写，无辅助调用可失败 |
| 进行中状态丢失 | 事件日志不可变；GUI 原文保留；dsh-rewind 可回退 |

## 4. 项目结构

```
dsh-clear-mind/
├── package.json        # name: dsh-clear-mind；dependencies 对齐 0.1.2-rc.1 并 npm install（dev-dsh-plugin 坑）
├── cordis.patch.yml    # - insert: [{id: clear-mind, name: dsh-clear-mind}]
├── tsconfig.json       # NodeNext, outDir dist
├── src/
│   ├── index.ts        # apply：inject [tools, tokenMeter, skills]；注册两工具 + skill + pre-step 自折叠
│   ├── config.ts       # Config（schemastery）：minClearTokens/minNotesChars/maxNotesChars/selfCollapse
│   ├── scan.ts         # mind_map 数据构建（纯函数，入参 session+measurement）
│   ├── render.ts       # survey 文本渲染（纯函数）
│   ├── commit.ts       # 区间校验 + 事务提交（真实 Session 上可测）
│   ├── collapse.ts     # 自折叠计划与执行（纯函数 + Session 应用）
│   ├── tools.ts        # defineTool 包装（参数/输出 schema/render/presentCall）
│   └── skill.ts        # skill 正文与注册
├── test/               # node --test，真实 Session 构造（仿 proactive 测试）
├── docs/features/260910-context-clearmind/{research,plan,summary,review,validation}.md
├── AGENTS.md / README.md
```

## 5. 实施步骤

1. 脚手架：package.json（deps: dsh-session/dsh-llm/dsh-compaction/dsh-tools/cordis @ 0.1.2-rc.1 + npm install）、tsconfig、cordis.patch.yml。
2. `scan.ts` + `render.ts`：surface 扫描（turn 归属、callId→工具名、预览提取、检查点标记、平衡端点）与文本渲染。
3. `commit.ts`：解析哨兵 → 校验（平衡/地板/长度/更小）→ 四事件事务。
4. `collapse.ts`：pending 登记 + pre-step 守卫 + 擦除事务。
5. `tools.ts`：两工具 schema/render/presentCall/presentResult。
6. `skill.ts` + `index.ts`：装配、runtime skill 注册。
7. 单测：真实 Session 构造多 turn 历史断言——survey 正确性、边界拒绝、事务事件序、shadow-price 协议（token-meter fold 一致）、自折叠守卫（含混合调用跳过）、检查点派生消息正确、GUI compactSource 识别字段。
8. tsc + node --test 全绿。
9. E2E：隔离 DSH_HOME（/tmp/e2e-clearmind）+ 测试 profile（dsh-base + dsh-headless + link 本插件，agent-default-model 指 cpa/lite）：
   - 任务 A：先闲聊两轮产生历史 → 指令"调用 mind_map"→ 断言日志有 tool/call(mind_map) 且模型转述地图。
   - 任务 B：指令"调用 clear_mind(start="first", end="latest", notes=<固定文本>)"→ 断言日志含完整 compaction 事务、surface 折叠、下回合正常、自折叠落地。
   - 断言基于会话 JSONL + surface 重放（Session.fromRestore / foldSurface）。
10. reviewer 检视 → 修复 → 复检。
11. 安装：web profile 加 link + bundles（先隔离端口验证，重启需用户同意）。

## 6. 明确不做（v1 范围外）

- 辅助 LLM 摘要模式（summarySource: "generate"）——平台 auto-compaction 已是安全网。
- dryRun 预览——mind_map 已给出全部决策数据，校验 fail-loud 带修正提示。
- anchor+direction 语义区间——显式 seq + 哨兵更通用，mind_map 提供权威 seq。
- 冷却/断路器——零 LLM 成本 + 地板已阻断循环；观察后再决定。
- Anthropic Compaction API / Context Editing 对接——provider 侧原语，dsh 走自建 surface 层，记为长期方向。
- 人类斜杠命令——/compact 已存在；本插件专注模型自主。
