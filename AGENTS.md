# dsh-clear-mind AGENTS.md

## 职责

给 root agent 注册 mind_map / clear_mind 两个工具 + clear-mind 技能：模型可自主把一段会话历史替换成检查点（「清空脑子」），调用对随后自动折叠。

## 地图

- `src/config.ts` — schemastery Config + resolveConfig（minClearTokens/minNotesChars/maxNotesChars/selfCollapse）
- `src/scan.ts` — scanSurface：事件日志 → Survey（节点/边界标记/turn 归属/latestEndSeq）；MeterPort 端口类型
- `src/render.ts` — renderSurvey：模型面对的地图文本；RENDER_NODE_LIMIT=140 超限按 turn 聚合
- `src/commit.ts` — commitClearMind 全事务 + frameCheckpointMessage（<compacted-summary> + compactCheckpointSource）
- `src/collapse.ts` — planCollapses 无状态检测 + applyCollapse（prune + user/message notice tombstone）
- `src/tools.ts` — defineTool 两工具；presentationMeta 携带 collapse 统计；route 解析（session.requestHeader → agent.options）
- `src/skill.ts` — 技能内容（中文；字符串内引号用「」避免转义问题）
- `src/index.ts` — cordis apply：inject/MeterPort/roots+agent/created 注册/技能注册/agent-pre-step 自折叠
- `test/` — 真实 Session 脚本化构造器 + assertShadowPriceProtocol 全日志断言

## 开发

- `npm run check`（tsc --noEmit src+test）→ `npm test`（tsc + node --test 'dist/test/*.test.js'，glob 形式）→ `npm run build`（dist/src）
- 依赖必须显式声明且本地安装（link-package 坑：ESM 解析失败会拖垮整棵 plugin tree）
- 平台 API 以 /usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/ 的 .d.ts 为准

## 核心契约（违反即毒化会话）

1. replace 区间 = surface 位置语义；seq 非单调，禁止当数值区间比较
2. replace 前必须紧跟 shadowedRange/shadowedSeqs/shadowedTokenCount 精确匹配的 summary/prune 事件
3. 禁止在 step 窗口外追加 assistant/message（token meter 会让整个会话 replay 抛错）——可见替换一律 user/message
4. compaction 括号必须闭合；错误路径 best-effort compaction/end {error}
5. SessionSeq/CompactionId 是品牌类型，plain number 过不了 tsc

## Pitfalls（本项目实测）

- read 工具 limit 截断回写曾把 package.json 写坏——改长文件读全或用 edit
- python yaml 往返会把 YAML1.1 的 off/on 键损坏成 false/true——settings 切片用文本方式
- tool/result 的 sourceEventSeqs 不能为空（须引用 assistant 事件）；事件字段是 toolCallId 不是 callId
- 工具测试模型选型：lite 级模型可能陷入推理循环不吐工具调用；E2E 用 medium
- E2E 隔离环境：DSH_HOME 指向独立目录 + node_modules 全量符号链接 + 文本切片的 settings.yaml；agent-default-model 用 profile patch 覆盖
