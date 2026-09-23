# 260923-invalid-replace-surface-op 用户验证

## 验证说明

- 验证对象：`clear_mind` 与自折叠生成的 surface replace 事件结构修复（对齐 DSH 0.1.5-rc.3 平台契约 `startSeq` / `endSeq`）
- 环境/前置条件：DSH 运行时（含 4180 / 4188 或重启后的生产环境）

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| -------- | -------- | -------- | ---- | --------- |
| 1. 执行 TypeScript 类型检查 `npm run check` | 编译无任何类型报错 | 零错误通过 | 通过 | `tsc -p tsconfig.json --noEmit` 成功 |
| 2. 运行完整单元测试 `npm test` | 全部 54 项测试通过，包含所有 replace 与折叠测试 | 54/54 全部通过 | 通过 | 包含 `commitClearMind` 与 `applyCollapse` |
| 3. 会话中调用 `clear_mind` 执行上下文压缩 | 正常返回压缩结果，不再抛出 `invalid replace surfaceOp`，生成包含摘要的检查点 | 待重启生效后实机验证 | 待验证 | 产物已编译，需 DSH 重载插件 |

## 验证结论

待验证

## 待跟进

无
