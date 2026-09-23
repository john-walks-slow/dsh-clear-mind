# dsh-clear-mind AGENTS.md

## 职责

给 root agent 注册 mind_map / clear_mind 两个工具：模型可自主把一段会话历史替换成检查点（「清空脑子」），调用对随后自动折叠。clear-mind 最佳实践（何时清理、怎么选区间、怎么写 notes）已折叠进 mind_map 的 description + 返回，不再单独注册技能——模型调一次 mind_map 即得地图+操作手册，省一轮 skill 读取。

## 地图

- `src/config.ts` — schemastery Config + resolveConfig（minClearTokens/minNotesChars/maxNotesChars/selfCollapse/playbook/presetPlaybook/reminder*）；PlaybookOverride = 8 个提示词段位的自由文本覆盖，逐段合并 preset > 全局 > 内置，空白段=保留内置
- `src/prompts.ts` — 提示词文案层：PlaybookPrompts（title/rangeGuide/notesGuide/selfCheck/callHint/signals/reminderHead/reminder）+ DEFAULT_PLAYBOOK 内置文案 + resolvePlaybook(config, presetId)。改内置文案只动这里；内置文案有逐字回归测试
- `src/scan.ts` — scanSurface：事件日志 → Survey（节点/边界标记/turn 归属/latestEndSeq）；MeterPort 端口类型
- `src/render.ts` — renderSurvey：模型面对的地图文本；RENDER_NODE_LIMIT=140 超限按 turn 聚合；可清理时末尾附 playbook（由传入的 PlaybookPrompts 驱动，默认内置；字符串内引号用「」避免转义）
- `src/commit.ts` — commitClearMind 全事务 + frameCheckpointMessage（<compacted-summary> + compactCheckpointSource）
- `src/collapse.ts` — planCollapses 无状态检测 + applyCollapse（prune + user/message notice tombstone）
- `src/tools.ts` — defineTool 两工具；mind_map description 的「何时清理」信号段取 prompts.signals、返回带 playbook；presentationMeta 携带 collapse 统计；route 解析（session.requestHeader → agent.options）
- `src/index.ts` — cordis apply：inject/MeterPort/roots+agent/created 注册（per-agent 用 session.header.agentPreset 解析提示词覆盖）/agent-pre-step 自折叠+reminder（reminder 触发时现场解析）
- `test/` — 真实 Session 脚本化构造器 + assertShadowPriceProtocol 全日志断言；prompts.test.ts 覆盖逐段合并优先级与内置文案回归

## 开发

- `npm run check`（tsc --noEmit src+test）→ `npm test`（tsc + node --test 'dist/test/*.test.js'，glob 形式）→ `npm run build`（dist/src）
- 依赖必须显式声明且本地安装（link-package 坑：ESM 解析失败会拖垮整棵 plugin tree）
- 平台 API 以 /usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/ 的 .d.ts 为准

## 核心契约（违反即毒化会话）

1. replace 区间 = surface 位置语义；seq 非单调，禁止当数值区间比较
2. replace 前必须紧跟 shadowedRange/shadowedSeqs/shadowedTokenCount 精确匹配的 summary/prune 事件
3. surfaceOp replace 结构必须为严格的 { op: "replace", startSeq, endSeq }（DSH 0.1.5+ 严格校验 startSeq/endSeq，禁止多余键；但 compaction/summary.shadowedRange 仍为 { start, end }）
4. 禁止在 step 窗口外追加 assistant/message（token meter 会让整个会话 replay 抛错）——可见替换一律 user/message
5. compaction 括号必须闭合；错误路径 best-effort compaction/end {error}
6. SessionSeq/CompactionId 是品牌类型，plain number 过不了 tsc

## Pitfalls（本项目实测）

- SurfaceOp 字段名演进：由旧版 start/end 改为 startSeq/endSeq；本地 node_modules 需同步平台最新 .d.ts，断言避免用 any/可选类型掩盖属性变更
- read 工具 limit 截断回写曾把 package.json 写坏——改长文件读全或用 edit
- python yaml 往返会把 YAML1.1 的 off/on 键损坏成 false/true——settings 切片用文本方式
- tool/result 的 sourceEventSeqs 不能为空（须引用 assistant 事件）；事件字段是 toolCallId 不是 callId
- 工具测试模型选型：lite 级模型可能陷入推理循环不吐工具调用；E2E 用 medium
- E2E 隔离环境：DSH_HOME 指向独立目录 + node_modules 全量符号链接 + 文本切片的 settings.yaml；agent-default-model 用 profile patch 覆盖
