# clear-mind 用户验证

## 验证说明

- 验证对象：dsh-clear-mind 插件（mind_map / clear_mind 工具 + clear-mind 技能 + 自折叠）在真实 dsh web 会话中的表现
- 环境/前置条件：插件已安装到 web profile 并重启 dsh web（见 README 安装步骤）；任一会话中模型可用 mind_map/clear_mind 工具

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| 1. 新会话让模型「先随便跑一个大输出的命令(比如 seq 1 300),然后调用 mind_map 给你看上下文地图」 | 模型能调用 mind_map 并粘贴出地图:节点行带 seq/类型/tokens/预览,▸/◂/◆ 标记,头部有 "NOT numeric-sorted" 提示与 "Latest clearable end: seq N" |  | 待验证 |  |
| 2. 让模型「用 clear_mind 清掉 first 到最新可清理边界的全部历史,notes 写成任务/关键事实/放弃路径/下一步四段」 | 工具成功:返回 "Cleared N messages (~X tokens) into checkpoint seq Y. Surface: ~A → ~B tokens";模型随后用两三句重述目标再继续 |  | 待验证 |  |
| 3. 清完后让模型再调一次 mind_map | 地图只剩 1-2 个节点:◆ 检查点 + 当前 turn 的新节点;之前的节点全部消失 |  | 待验证 |  |
| 4. 让模型再做一轮正常工作(几次工具调用),然后再看 mind_map | 之前 clear_mind 的调用+结果对折叠成一行 "clear-mind: cleared N messages…" 的 notice(不再有完整调用参数和长结果);会话无异常,后续请求正常 |  | 待验证 | 自折叠在下一步边界生效 |
| 5. 在设置页/会话里确认无报错:打开 dsh web 的会话列表,反复打开该会话、刷新页面 | 会话可正常加载渲染,无 "token meter"/"no matching step/start" 或 compaction 相关错误;GUI 会话视图显示检查点行(压缩视图) |  | 待验证 | 回归验证 meter replay 未被毒化 |
| 6. 让模型尝试用旧的(过期) seq 调 clear_mind | 被拒绝且错误信息可行动:"not on the current surface. Call mind_map…"——模型应重扫后成功或放弃 |  | 待验证 |  |

## 验证结论

待验证。

## 待跟进

无。
