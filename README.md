# dsh-clear-mind

让模型自主压缩自身上下文的 DeepSeek Harness 插件：当失败探索和大输出把上下文拖累时，模型可以「清空脑子」——把一段对话历史替换成自己写的检查点，只留笔记，释放注意力与 token 预算。

## 组件

- **`mind_map` 工具**：扫描会话 surface，返回上下文地图（seq/类型/tokens/预览 + ▸/◂/◆ 边界标记）。seq 是身份不是数值区间（replace 后非单调）。
- **`clear_mind` 工具**：`clear_mind(start, end, notes)` 把 [start..end] 区间替换为检查点 notes。事务镜像平台 compaction 引擎（compaction/start → summary（影子价格）→ user/message replace → end），失败路径 fail-closed。
- **自折叠**：成功的 clear_mind 调用+结果对在下一步边界自动折叠成一行 notice tombstone（走 compaction/prune + replace 影子价格协议）。
- **`clear-mind` 技能**：教模型何时清、怎么写 notes、单独调用纪律与注入防护。

## 安装（到某个 profile）

```bash
cd ~/.dsh/profiles/<name>
pnpm add file:/root/projects/dsh-clear-mind   # 或发布后的包名
```

profile `package.json` 的 `dsh.profile.bundles` 加入 `"dsh-clear-mind"`；插件自带 `cordis.patch.yml` 自动生效。重启 dsh 后模型即获得工具与技能。

## 配置（可选，cordis patch 覆盖）

```yaml
- id: clear-mind
  name: dsh-clear-mind
  config:
    minClearTokens: 1000   # 最小可清理量（启发式 tokens）
    minNotesChars: 200     # notes 最短长度
    maxNotesChars: 16000   # notes 最长长度
    selfCollapse: true     # 是否自动折叠 clear_mind 调用对
```

## 开发

```bash
npm install
npm run check   # tsc --noEmit（src+test）
npm test        # tsc + node --test（21 用例，真实 Session 构造）
npm run build   # 产物 dist/src/
```

单测用启发式 meter 副本（与断言一致即可）；运行时绑定平台 `ctx.tokenMeter`（MeterPort 端口注入）。

## 平台契约（改动前必读）

- replace 区间是 **surface 位置语义**；replace 后 seq 非单调。
- 每次 replace 必须紧跟携带精确 shadowedRange/shadowedSeqs/shadowedTokenCount 的 `compaction/summary`/`compaction/prune`（影子价格协议）。
- **绝不**在 step 窗口外追加 `assistant/message`——token meter 要求每个 assistant/message 匹配 step/start..step/end，否则毒化整个会话的 meter replay。插件可见的替换一律用 user/message（引擎同款）。
- compaction 括号必须闭合（错误路径 best-effort `compaction/end {error}`），否则会话永久无法加载。
- dsh-tools defineTool：parameters 每属性 `required: true`；output.schema 用显式 object 根。

## 文档

- 调研：`docs/features/260910-context-clearmind/260910-context-compaction-prior-art.research.md`
- 计划：`docs/features/260910-context-clearmind/260910-context-clearmind.plan.md`
- 摘要：`docs/features/260910-context-clearmind/260910-context-clearmind.summary.md`
- 检视：`docs/features/260910-context-clearmind/260910-context-clearmind.review.md`
- 用户验证：`docs/features/260910-context-clearmind/260910-context-clearmind.validation.md`
