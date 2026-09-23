# 排查诊断：clear_mind 抛出 "invalid replace surfaceOp"

- 问题编号：`260923-invalid-replace-surface-op`
- 日期：2026-09-23
- 状态：已确诊（置信度 100%）

---

## 1. 现象描述

在会话中调用 `clear_mind` 工具执行上下文压缩时，执行失败并向模型和用户抛出异常：
```text
Error: session event "user/message" carries an invalid replace surfaceOp
```

---

## 2. 根因分析

### 2.1 DSH 平台契约演进
在 DSH 平台底层核心库 `@deepseek-ai/dsh-session` 升级（由 0.1.2-rc.1 升级至 0.1.5-rc.3）后，`SurfaceOp` 接口定义与表层事件操作校验规则更新：

```typescript
// @deepseek-ai/dsh-session/lib/types/types.d.ts
export type SurfaceOp = 'append' | {
    op: 'replace';
    startSeq: SessionSeq;
    endSeq: SessionSeq;
};
```

底层运行时在追加替换事件时执行严格校验（`/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/surface.js`）：
```javascript
function isReplaceOp(value) {
    const op = value;
    return Object.keys(op).length === 3
        && Object.hasOwn(op, 'op')
        && Object.hasOwn(op, 'startSeq')
        && Object.hasOwn(op, 'endSeq')
        && op['op'] === 'replace'
        && isEventSeq(op['startSeq'])
        && isEventSeq(op['endSeq']);
}
```
该函数严格检查对象仅有 3 个 key，且必须包含 `op`、`startSeq`、`endSeq`。

### 2.2 插件内部代码不符
在 `dsh-clear-mind` 源码中：
1. `src/commit.ts`（第 224 行）在创建替换的 `user/message` 事件时：
   ```typescript
   surfaceOp: { op: "replace", start: SessionSeq(startSeq), end: SessionSeq(endSeq) }
   ```
2. `src/collapse.ts`（第 200 行）在为 `clear_mind` 和 `mind_map` 工具调用对折叠生成 tombstone 时：
   ```typescript
   surfaceOp: { op: "replace", start: SessionSeq(plan.assistantSeq), end: SessionSeq(lastSeq) }
   ```
字段名为 `start` 和 `end`，而非平台的 `startSeq` 和 `endSeq`。
当事件提交至宿主 Session 时，触发 `!isReplaceOp(op)` 判定，直接抛出 `Error: session event "user/message" carries an invalid replace surfaceOp`。

### 2.3 为什么本地测试此前通过
本地 `node_modules/@deepseek-ai/dsh-session` 安装的是旧版 0.1.2-rc.1（当时的实现为 `start` / `end`），且 `test/helpers.ts` 中的断言使用了 `(event as any).surfaceOp.start`。
因此本地测试使用的是旧契约，而 DSH 生产运行时运行的是最新的 0.1.5-rc.3。

---

## 3. 修复方案

1. **代码修复**：
   - 将 `src/commit.ts` 中的 `start` / `end` 字段更正为 `startSeq` / `endSeq`。
   - 将 `src/collapse.ts` 中的 `start` / `end` 字段更正为 `startSeq` / `endSeq`。
   - 更新 `test/helpers.ts` 及各测试用例中的字段访问为 `startSeq` / `endSeq`。
2. **依赖更新**：
   - 将本地 `package.json` 中的 `@deepseek-ai/*` 依赖版本对齐到平台实际运行的 `0.1.5-rc.3`。
   - 更新本地 `node_modules`，使 `tsc` 和 `npm test` 在最新契约下进行严格验证。
3. **构建与测试验证**：
   - 运行 `npm run check`（TypeScript 类型检查无错误）。
   - 运行 `npm test`（54 项单元测试全部通过）。
   - 运行 `npm run build` 生成最新 `dist/` 构建产物。

---

## 4. 置信度与影响评估

- **置信度**：100%（源码、报错位置、核心库校验逻辑完全吻合）。
- **影响范围**：仅针对 `SurfaceOp` 属性字段名，不影响业务逻辑与调度机制。
