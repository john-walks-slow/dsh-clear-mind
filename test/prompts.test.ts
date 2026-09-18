/**
 * Unit tests for the prompt override layer (src/prompts.ts + config) and its
 * consumers: renderSurvey's playbook block, the mind_map description, and the
 * proactive reminder text. The built-in set must reproduce the original
 * hardcoded wording byte-for-byte (regression); operator overrides replace
 * field by field with preset > global > built-in precedence.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfig } from "../src/config.js";
import { DEFAULT_PLAYBOOK, resolvePlaybook } from "../src/prompts.js";
import { renderSurvey } from "../src/render.js";
import { buildReminderMessage } from "../src/reminder.js";
import { mindMapTool } from "../src/tools.js";
import type { MeterPort, Survey } from "../src/scan.js";

/** A minimal survey with an actionable clear boundary and one node per turn. */
function surveyWithBoundary(): Survey {
	return {
		kind: "survey",
		surfaceNodes: 2,
		surfaceTokens: 1200,
		requestPressureTokens: 900,
		latestEndSeq: 5,
		turns: [{ turn: 1, startSeq: 1, endSeq: 5, nodes: 2, tokens: 1200, firstUserPreview: "fix build" }],
		nodes: [
			{ seq: 1, turn: 1, kind: "user", tokens: 100, preview: "fix build", validStart: true, validEnd: true, checkpoint: false },
			{ seq: 5, turn: 1, kind: "assistant", tokens: 1100, preview: "done", validStart: true, validEnd: true, checkpoint: false }
		]
	};
}

function meterStub(): MeterPort {
	return { measure: () => undefined as never, estimateMessage: () => 0 };
}

/** First text block of a message's content (reminder messages carry exactly one). */
function textOf(message: { content: readonly { type: string; text?: string }[] }): string {
	const block = message.content[0];
	if (block === undefined || block.type !== "text" || block.text === undefined) throw new Error("expected a text block");
	return block.text;
}

const config = resolveConfig({ minClearTokens: 1, minNotesChars: 10, maxNotesChars: 16000 });

test("resolveConfig defaults to empty overrides and keeps only known string keys", () => {
	const resolved = resolveConfig({});
	assert.deepEqual(resolved.playbook, {});
	assert.deepEqual(resolved.presetPlaybook, {});
	const messy = resolveConfig({
		playbook: { title: "T", signals: 42, bogus: "x", selfCheck: "" },
		presetPlaybook: { roleplay: { callHint: "H", nope: 1 }, bad: "junk" } as never
	});
	assert.deepEqual(messy.playbook, { title: "T", selfCheck: "" });
	assert.deepEqual(messy.presetPlaybook, { roleplay: { callHint: "H" }, bad: {} });
});

test("resolvePlaybook with no overrides returns the built-in wording byte-for-byte", () => {
	const prompts = resolvePlaybook(config, "roleplay");
	assert.equal(prompts.title, DEFAULT_PLAYBOOK.title);
	assert.equal(prompts.rangeGuide.includes("选区间：清「已完成的旧阶段」"), true);
	assert.equal(prompts.notesGuide.includes("  ## 任务与用户意图（关键处引用原话）"), true);
	assert.equal(prompts.selfCheck.includes("外化到 todo/记忆/文件"), true);
	assert.ok(prompts.signals.includes("①"));
});

test("global override replaces single fields, others keep the built-in text", () => {
	const styled = resolveConfig({ playbook: { title: "— 清理指引 —", notesGuide: "笔记讲清楚：想做什么、知道了什么、别再试什么、还剩什么、下一步。" } });
	const prompts = resolvePlaybook(styled, undefined);
	assert.equal(prompts.title, "— 清理指引 —");
	assert.deepEqual(prompts.notesGuide, ["笔记讲清楚：想做什么、知道了什么、别再试什么、还剩什么、下一步。"]);
	assert.equal(prompts.rangeGuide.includes("选区间"), true);
	assert.ok(prompts.signals.includes("①"));
	// Multi-line overrides render one output line per \n, indentation kept.
	const multilineOverride = resolveConfig({ playbook: { notesGuide: "intro\n  ## kept indent\nlast" } });
	assert.deepEqual(resolvePlaybook(multilineOverride, undefined).notesGuide, ["intro", "  ## kept indent", "last"]);
});

test("preset override wins field by field over global; blank falls through; other presets unaffected", () => {
	const styled = resolveConfig({
		playbook: { title: "global title", selfCheck: "global self-check" },
		presetPlaybook: { roleplay: { title: "roleplay title", selfCheck: "  " } }
	});
	const roleplay = resolvePlaybook(styled, "roleplay");
	assert.equal(roleplay.title, "roleplay title");
	assert.equal(roleplay.selfCheck, "global self-check");
	assert.equal(roleplay.rangeGuide.includes("选区间"), true);
	assert.equal(resolvePlaybook(styled, "agent").title, "global title");
	assert.equal(resolvePlaybook(styled, undefined).title, "global title");
});

test("renderSurvey emits the operator's playbook text instead of the template", () => {
	const custom = resolveConfig({
		presetPlaybook: {
			roleplay: {
				title: "— 清理指引 —",
				rangeGuide: "把告一段落的部分清掉，最近的对话保持原样。",
				notesGuide: "笔记讲清楚这几件事：一开始想做成什么、现在知道了什么、哪些路走不通别再试、还有什么没做完、接下来做什么。",
				selfCheck: "收尾前扫一眼：没做完的事都记了吗？后面要用的细节都在吗？",
				callHint: "分几段清就在同一条消息里多调几次 clear_mind。"
			}
		}
	});
	const text = renderSurvey(surveyWithBoundary(), resolvePlaybook(custom, "roleplay"));
	assert.ok(text.includes("— 清理指引 —"));
	assert.ok(text.includes("把告一段落的部分清掉"));
	for (const banned of ["##", "参考模板", "宁滥勿缺", "选区间", "外化到 todo/记忆/文件"]) {
		assert.ok(!text.includes(banned), "custom playbook must not contain built-in wording: " + banned);
	}
	// The map's protocol header stays untouched — only the playbook restyles.
	assert.ok(text.includes("Seqs are ids in surface order"));
});

test("mind_map description uses the operator's signals paragraph", () => {
	const builtIn = mindMapTool(meterStub(), DEFAULT_PLAYBOOK);
	assert.match(builtIn.description, /该梳理的信号（满足其一）：①/);
	const custom = mindMapTool(meterStub(), { ...DEFAULT_PLAYBOOK, signals: "想清就先看一眼地图，别在忙不过来的时候清。" });
	assert.ok(custom.description.includes("想清就先看一眼地图"));
	assert.doesNotMatch(custom.description, /①/);
	for (const description of [builtIn.description, custom.description]) {
		assert.match(description, /Survey your own context surface/);
		assert.match(description, /Takes no arguments\./);
	}
});

test("reminder text uses the operator's head and body lines, reasons stay data-driven", () => {
	const trigger = { reasons: ["上下文已占模型窗口的 71%（7100/10000 tokens，阈值 70%）"], turn: 3, step: 9, totalTokens: 7100, contextWindow: 10000 };
	const builtIn = textOf(buildReminderMessage(trigger, DEFAULT_PLAYBOOK));
	assert.ok(builtIn.includes("[Context / Step Alert] 当前会话已达到主动清理检查点："));
	const custom = textOf(buildReminderMessage(trigger, {
		...DEFAULT_PLAYBOOK,
		reminderHead: "上下文维护提醒：这场对话已经积累了不少——",
		reminder: ["有空时先调用 mind_map 看看全貌，把告一段落的部分整理成笔记、用 clear_mind 清掉。"]
	}));
	assert.ok(custom.includes("上下文维护提醒"));
	assert.ok(custom.includes("有空时先调用 mind_map"));
	assert.ok(!custom.includes("[Context / Step Alert]"));
	for (const text of [builtIn, custom]) {
		assert.ok(text.includes("<system-reminder>"));
		assert.ok(text.includes("- 原因：上下文已占模型窗口的 71%"));
	}
});
