/**
 * Unit tests for the per-preset prompt style layer (src/prompts.ts) and its
 * consumers: renderSurvey's playbook block, the mind_map description, and the
 * proactive reminder text. The engineering set must reproduce the original
 * hardcoded wording byte-for-byte (regression), the natural set must carry no
 * template headings or operator jargon markers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfig } from "../src/config.js";
import { playbookFor, resolvePlaybook } from "../src/prompts.js";
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

test("resolveConfig defaults to the engineering style with an empty preset map", () => {
	const resolved = resolveConfig({});
	assert.equal(resolved.playbookStyle, "engineering");
	assert.deepEqual(resolved.presetPlaybookStyle, {});
});

test("resolveConfig validates playbook style values strictly", () => {
	assert.throws(() => resolveConfig({ playbookStyle: "casual" as never }), /playbookStyle/);
	assert.throws(() => resolveConfig({ presetPlaybookStyle: { roleplay: "poetic" } as never }), /presetPlaybookStyle\["roleplay"\]/);
	const resolved = resolveConfig({ presetPlaybookStyle: { roleplay: "natural", agent: "engineering" } });
	assert.deepEqual(resolved.presetPlaybookStyle, { roleplay: "natural", agent: "engineering" });
});

test("resolvePlaybook: preset override wins, then global default, unknown preset falls back", () => {
	const styled = resolveConfig({ playbookStyle: "natural", presetPlaybookStyle: { agent: "engineering" } });
	assert.equal(resolvePlaybook(styled, "agent").title, "— clear-mind playbook —");
	assert.equal(resolvePlaybook(styled, "roleplay").title, "— 清理指引 —");
	// A preset without an entry uses the global default.
	assert.equal(resolvePlaybook(styled, "yuyu").title, "— 清理指引 —");
	// No preset at all uses the global default.
	assert.equal(resolvePlaybook(styled, undefined).title, "— 清理指引 —");
	// Engineering default for an unknown preset when nothing is configured.
	assert.equal(resolvePlaybook(config, "roleplay").title, "— clear-mind playbook —");
});

test("engineering playbook reproduces the original wording byte-for-byte", () => {
	const text = renderSurvey(surveyWithBoundary(), playbookFor("engineering"));
	for (const marker of [
		"— clear-mind playbook —",
		"选区间：清「已完成的旧阶段」",
		"notes 参考模板：",
		"## 任务与用户意图（关键处引用原话）",
		"提交前自检（防丢）",
		"外化到 todo/记忆/文件"
	]) {
		assert.ok(text.includes(marker), "engineering playbook must contain: " + marker);
	}
});

test("natural playbook drops template headings and operator jargon", () => {
	const text = renderSurvey(surveyWithBoundary(), playbookFor("natural"));
	assert.ok(text.includes("— 清理指引 —"));
	for (const banned of ["##", "参考模板", "宁滥勿缺", "选区间", "verbatim"]) {
		assert.ok(!text.includes(banned), "natural playbook must not contain: " + banned);
	}
	// The map's protocol header stays technical — only the playbook restyles.
	assert.ok(text.includes("Seqs are ids in surface order"));
});

test("mind_map description swaps the signals paragraph with the style", () => {
	const engineering = mindMapTool(meterStub(), playbookFor("engineering"));
	const natural = mindMapTool(meterStub(), playbookFor("natural"));
	assert.match(engineering.description, /该梳理的信号（满足其一）：①/);
	assert.match(natural.description, /这些时刻值得停下来梳理一下/);
	assert.doesNotMatch(natural.description, /①/);
	// Both keep the mechanical contract sentences.
	for (const description of [engineering.description, natural.description]) {
		assert.match(description, /Survey your own context surface/);
		assert.match(description, /Takes no arguments\./);
	}
});

test("reminder text follows the style while keeping the data-driven reasons line", () => {
	const trigger = { reasons: ["上下文已占模型窗口的 71%（7100/10000 tokens，阈值 70%）"], turn: 3, step: 9, totalTokens: 7100, contextWindow: 10000 };
	const engineering = textOf(buildReminderMessage(trigger, playbookFor("engineering")));
	const natural = textOf(buildReminderMessage(trigger, playbookFor("natural")));
	assert.ok(engineering.includes("[Context / Step Alert] 当前会话已达到主动清理检查点："));
	assert.ok(natural.includes("上下文维护提醒"));
	assert.ok(!natural.includes("[Context / Step Alert]"));
	for (const text of [engineering, natural]) {
		assert.ok(text.includes("<system-reminder>"));
		assert.ok(text.includes("- 原因：上下文已占模型窗口的 71%"));
	}
});
