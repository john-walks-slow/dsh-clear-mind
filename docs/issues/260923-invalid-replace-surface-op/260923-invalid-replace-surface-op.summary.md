# 260923-invalid-replace-surface-op 修复总结

## 背景

在用户要求执行 `clear_mind` 进行上下文清理时，DSH 宿主抛出异常：
`Error: session event "user/message" carries an invalid replace surfaceOp`。

## 根本原因

DSH 平台底层核心库 `@deepseek-ai/dsh-session` 近期升级（至 0.1.5-rc.3），规范了 `surfaceOp` 的表层替换对象结构：
从旧版的 `{ op: 'replace', start, end }` 调整为 `{ op: 'replace', startSeq, endSeq }`。
在 `dsh-clear-mind` 插件中：
1. `src/commit.ts` 的 `commitClearMind` 创建 checkpoint 事件时仍使用 `start` / `end`。
2. `src/collapse.ts` 的 `applyCollapse` 创建折叠 tombstone 时仍使用 `start` / `end`。
由于不符合 `isReplaceOp` 对属性名 `startSeq` 与 `endSeq` 的严格断言，被宿主 Session 拦截并拒绝。

## 修复实施

1. **源码更正**：
   - 将 `src/commit.ts` 中 `surfaceOp` 的 `start` / `end` 改为 `startSeq` / `endSeq`。
   - 将 `src/collapse.ts` 中 `surfaceOp` 的 `start` / `end` 改为 `startSeq` / `endSeq`。
2. **测试与依赖对齐**：
   - 将 `package.json` 中的 `@deepseek-ai/*` 依赖版本更新为 `0.1.5-rc.3`。
   - 同步本地 `node_modules/@deepseek-ai/*` 与全局平台一致。
   - 适配单元测试中 SessionHeader 版本及 `assistant/message` 的 `stream` 契约。
   - 更新 `test/helpers.ts` 中的断言逻辑以支持 `startSeq` / `endSeq`。
3. **验证结果**：
   - `npm run check`：TypeScript 类型检查通过。
   - `npm test`：54 项单元测试全部通过。
   - `npm run build`：生产产物已生成。

## 交付物

- 源码：`src/commit.ts`、`src/collapse.ts`
- 产物：`dist/`、`lib/client.js`
- 测试：`test/helpers.ts`、`test/commit.test.ts`、`test/scan.test.ts`
- 依赖声明：`package.json`
- 文档：`docs/issues/260923-invalid-replace-surface-op/`
