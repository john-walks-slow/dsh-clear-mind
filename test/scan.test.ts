import { test } from "node:test";
import assert from "node:assert/strict";
import { Session, deriveEventMessage } from "@deepseek-ai/dsh-session";
import { ToolCallId, createAssistantMessage } from "@deepseek-ai/dsh-llm";
import { scanSurface } from "../src/scan.js";
import { renderSurvey } from "../src/render.js";
import { commitClearMind } from "../src/commit.js";
import { resolveConfig } from "../src/config.js";
import { appendTurn, replicaMeter } from "./helpers.js";

const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor "; // 82 chars

test("scanSurface reports kinds, previews, boundaries, and latest end", () => {
	const session = Session.create("s1" as never);
	appendTurn(session, 1, [
		{ user: "fix the build error in packages/api" },
		{ calls: [{ name: "bash", result: "npm error code ELIFECYCLE" }] },
		{ text: "the build broke because of a missing import" }
	]);
	appendTurn(session, 2, [
		{ user: "try vite instead" },
		{ calls: [{ name: "read", result: "42 lines" }] },
		{ text: "vite works now" }
	]);
	const meter = replicaMeter();
	const survey = scanSurface(session, meter);
	assert.equal(survey.surfaceNodes, 8, "user + call pair + text per turn");
	const kinds = survey.nodes.map((node) => node.kind);
	assert.deepEqual(kinds, ["user", "assistant", "tool", "assistant", "user", "assistant", "tool", "assistant"]);
	const user0 = survey.nodes[0];
	assert.equal(user0.turn, 1);
	assert.match(user0.preview, /fix the build error/);
	const tool0 = survey.nodes[2];
	assert.equal(tool0.toolName, "bash");
	assert.match(tool0.preview, /bash: npm error/);
	// boundary semantics: cutting before a tool/result or after a
	// call-carrying assistant would split a pair — those flags are false.
	const flags = survey.nodes.map((node) => [node.validStart, node.validEnd].join(":"));
	assert.deepEqual(flags, [
		"true:true", // u1
		"true:false", // a1 carries the call
		"false:true", // t1 answers it
		"true:true", // text
		"true:true", // u2
		"true:false", // a2
		"false:true", // t2
		"true:true" // text
	]);
	assert.equal(survey.latestEndSeq, survey.nodes[7].seq);
	assert.equal(survey.turns.length, 2);
	assert.equal(survey.turns[0].firstUserPreview, "fix the build error in packages/api");
	assert.ok(survey.requestPressureTokens > 0);
});

test("scanSurface marks an in-flight step as unbalanced", () => {
	const session = Session.create("s1" as never);
	appendTurn(session, 1, [{ user: "hello" }, { text: "hi there" }]);
	session.append("turn/start", { turn: 2 });
	const meter = replicaMeter();
	// open assistant with an unanswered call
	const before = session.seq;
	const assistant = createAssistantMessage({
		content: [{ type: "tool-call", id: ToolCallId("call-open"), name: "bash", arguments: "{}" }],
		source: { provider: "p", model: "m" }
	});
	session.append("assistant/message", { turn: 2, step: 1, message: assistant }, { surfaceOp: "append", sourceEventSeqs: [] });
	assert.ok(session.seq > before);
	const survey = scanSurface(session, meter);
	const open = survey.nodes[survey.nodes.length - 1];
	assert.equal(open.kind, "assistant");
	assert.equal(open.validEnd, false, "open tool-call cannot be a range end");
	assert.equal(open.validStart, true, "cut before the open assistant is balanced");
	assert.equal(survey.latestEndSeq, survey.nodes[survey.nodes.length - 2].seq);
});

test("scanSurface marks checkpoints after a clear_mind commit", () => {
	const session = Session.create("s1" as never);
	appendTurn(session, 1, [
		{ user: "explore " + LOREM.repeat(40) },
		{ calls: [{ name: "bash", result: LOREM.repeat(60) }] }
	]);
	appendTurn(session, 2, [{ user: "new direction " + LOREM.repeat(20) }, { text: "ok" }]);
	session.append("turn/start", { turn: 3 });
	const meter = replicaMeter();
	const config = { minClearTokens: 1, minNotesChars: 1, maxNotesChars: 16000, selfCollapse: true };
	const endSeq = session.surface.nodes[session.surface.nodes.length - 1];
	const report = commitClearMind(
		{ session, meter, config: config as never, route: { provider: "p", model: "m" } },
		"first", endSeq, "## Notes\nkey facts and decisions for the future"
	);
	assert.equal(report.kind, "cleared");
	const survey = scanSurface(session, meter);
	assert.equal(survey.surfaceNodes, 1, "checkpoint only — turn 3 added no surface nodes yet");
	const checkpointNode = survey.nodes[0];
	assert.equal(checkpointNode.checkpoint, true);
	assert.equal(checkpointNode.kind, "user");
	// checkpoint's turn attribution is the open turn that committed it
	assert.equal(checkpointNode.turn, 3);
});

test("renderSurvey shows markers, seqs, and the non-monotonic note", () => {
	const session = Session.create("s1" as never);
	appendTurn(session, 1, [{ user: "first task" }, { calls: [{ name: "bash", result: "ok" }] }]);
	appendTurn(session, 2, [{ user: "second task" }, { text: "done" }]);
	const text = renderSurvey(scanSurface(session, replicaMeter()));
	assert.match(text, /Mind surface: 5 nodes/);
	assert.match(text, /NOT numeric-sorted/);
	assert.match(text, /▸/);
	assert.match(text, /◂/);
	assert.match(text, /turn 1/);
	assert.match(text, /bash: ok/);
	assert.match(text, /Latest clearable end/);
});

test("renderSurvey aggregates old turns beyond the detail limit", () => {
	const session = Session.create("s1" as never);
	// 60 turns × 3 nodes = 180 nodes > RENDER_NODE_LIMIT (140)
	for (let turn = 1; turn <= 60; turn++) {
		appendTurn(session, turn, [
			{ user: "task " + turn },
			{ calls: [{ name: "bash", result: "output " + turn }] }
		]);
	}
	const survey = scanSurface(session, replicaMeter());
	assert.ok(survey.nodes.length > 140);
	const text = renderSurvey(survey);
	assert.match(text, /aggregated per turn/);
	// every turn still gets a line with boundary seqs
	assert.match(text, /turn 1 ·/);
	assert.match(text, /turn 60 ·/);
	// detailed tail lines exist (per-node lines carry a kind column)
	const detailed = text.split("\n").filter((line) => / (user|assistant|tool)\s+[0-9.]+[km]?\b/.test(line)).length;
	assert.equal(detailed, 140, "the most recent 140 nodes stay detailed");
});

test("scanSurface previews stay single-line and bounded", () => {
	const session = Session.create("s1" as never);
	appendTurn(session, 1, [
		{ user: LOREM + LOREM + "\nsecond line " + LOREM },
		{ text: "plain" }
	]);
	const survey = scanSurface(session, replicaMeter());
	const preview = survey.nodes[0].preview;
	assert.ok(!preview.includes("\n"));
	assert.ok(preview.length <= 50, "preview bounded: " + preview.length);
});
