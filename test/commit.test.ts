import { test } from "node:test";
import assert from "node:assert/strict";
import { Session, SessionSeq, deriveEventMessage } from "@deepseek-ai/dsh-session";
import { ToolCallId, createAssistantMessage } from "@deepseek-ai/dsh-llm";
import { commitClearMind } from "../src/commit.js";
import { resolveConfig } from "../src/config.js";
import { isCompactCheckpointSource } from "@deepseek-ai/dsh-compaction";
import { appendTurn, assertShadowPriceProtocol, eventsOf, replicaMeter } from "./helpers.js";

const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ";

const config = { minClearTokens: 1, minNotesChars: 10, maxNotesChars: 16000, selfCollapse: true } as never;
const route = { provider: "test-provider", model: "test-model" };

function fixture(): Session {
	const session = Session.create("s1" as never);
	appendTurn(session, 1, [
		{ user: "explore approach A " + LOREM.repeat(20) },
		{ calls: [{ name: "bash", result: LOREM.repeat(60) }] },
		{ text: "approach A failed because of permissions" }
	]);
	appendTurn(session, 2, [
		{ user: "try approach B " + LOREM.repeat(10) },
		{ calls: [{ name: "read", result: LOREM.repeat(30) }] }
	]);
	session.append("turn/start", { turn: 3 });
	return session;
}

test("commitClearMind lands the full compaction transaction and replaces the surface", () => {
	const session = fixture();
	const meter = replicaMeter();
	const surfaceBefore = [...session.surface.nodes];
	const endSeq = surfaceBefore[surfaceBefore.length - 1];
	const report = commitClearMind({ session, meter, config, route }, "first", endSeq,
		"## Mission\n- make the build green\n## Abandoned\n- approach A: EACCES");
	assert.equal(report.kind, "cleared");
	assert.equal(report.clearedNodes, surfaceBefore.length);
	assert.ok(report.clearedTokens > 0);
	assert.ok(report.surfaceTokensAfter < report.surfaceTokensBefore);
	// event order: start, summary, checkpoint replace, end
	const events = eventsOf(session);
	const tailTypes = events.slice(-4).map((event) => event.type);
	assert.deepEqual(tailTypes, ["compaction/start", "compaction/summary", "user/message", "compaction/end"]);
	// the surface now leads with the checkpoint, followed by the turn-3 prefix nodes
	const surface = session.surface.nodes as readonly number[];
	assert.equal(surface.length, 1 + 0, "turn 3 added no surface nodes yet in this fixture");
	const checkpointEvent = session.eventAt(SessionSeq(surface[0]));
	assert.ok(checkpointEvent !== undefined && checkpointEvent.type === "user/message");
	const message = deriveEventMessage(checkpointEvent);
	assert.ok(message !== null);
	const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
	assert.match(text, /<compacted-summary>/);
	assert.match(text, /make the build green/);
	assert.match(text, /clear-mind/);
	assert.ok(isCompactCheckpointSource(message.source));
	// compaction/summary carries the honest route and the exact shadow price
	const summaryEvent = events[events.length - 3];
	assert.ok(summaryEvent.type === "compaction/summary");
	assert.equal(summaryEvent.data.provider, "test-provider");
	assert.equal(summaryEvent.data.model, "test-model");
	// shadow-price protocol over the whole log
	const protocol = assertShadowPriceProtocol(session, meter.estimateMessage);
	assert.equal(protocol.replaces, 1);
	assert.equal(protocol.armedTotal, report.clearedTokens, "armed claim equals reported cleared tokens");
});

test("commitClearMind accepts ranges whose start seq is numerically greater than its end (position semantics)", () => {
	const session = fixture();
	const meter = replicaMeter();
	// surface before: [u1, a1, t1, u2, a2, t2]. Clear the MIDDLE span [a1..a2]:
	// the checkpoint lands at position 1 with a fresh HIGH seq, so the surviving
	// tail t2 (a lower seq) now sits AFTER it — seqs become non-monotonic.
	const surface = session.surface.nodes as readonly number[];
	const assistantSeq = surface[1];
	const assistant2Seq = surface[4];
	const first = commitClearMind({ session, meter, config, route }, assistantSeq, assistant2Seq, "## Notes\nmiddle span distilled");
	assert.equal(first.kind, "cleared");
	const afterFirst = session.surface.nodes as readonly number[];
	assert.equal(afterFirst.length, 4, "u1, checkpoint, t2(=end of cleared span's neighbor), turn-3 nodes");
	// second clear starts at the checkpoint (position 1, HIGH seq) and ends at
	// t2 (position 3, LOWER seq): numerically inverted, positionally valid.
	const tailSeq = afterFirst[3];
	assert.ok(first.checkpointSeq > tailSeq, "fixture must produce a numerically inverted range");
	const second = commitClearMind({ session, meter, config, route }, first.checkpointSeq, tailSeq, "## Notes\nsecond checkpoint absorbs the first");
	assert.equal(second.kind, "cleared");
	const protocol = assertShadowPriceProtocol(session, meter.estimateMessage);
	assert.equal(protocol.replaces, 2);
});

test("two disjoint segments clear in immediate succession without a fresh mind_map (multi-segment batch)", () => {
	const session = Session.create("s-multi" as never);
	appendTurn(session, 1, [
		{ user: "phase one " + LOREM.repeat(20) },
		{ calls: [{ name: "bash", result: LOREM.repeat(60) }] },
		{ text: "phase one done" }
	]);
	appendTurn(session, 2, [
		{ user: "phase two " + LOREM.repeat(20) },
		{ calls: [{ name: "read", result: LOREM.repeat(60) }] }
	]);
	session.append("turn/start", { turn: 3 });
	const meter = replicaMeter();
	// Surface: [u1, a1, t1, atext, u2, a2, t2]. Both ranges come from the SAME
	// survey and commit back-to-back, exactly as a same-message batch would
	// (the executor runs exclusive tools serially and commitClearMind is sync).
	const seqs = [...(session.surface.nodes as readonly number[])];
	const first = commitClearMind({ session, meter, config, route }, seqs[0], seqs[2], "## Notes\nsegment one distilled for the future");
	assert.equal(first.kind, "cleared");
	const second = commitClearMind({ session, meter, config, route }, seqs[4], seqs[6], "## Notes\nsegment two distilled for the future");
	assert.equal(second.kind, "cleared");
	// two checkpoints stand, with the untouched survivor between them
	const surface = session.surface.nodes as readonly number[];
	assert.equal(surface.length, 3);
	assert.ok(surface.includes(first.checkpointSeq));
	assert.ok(surface.includes(second.checkpointSeq));
	assert.ok(surface.includes(seqs[3]), "the node between the segments survives");
	const protocol = assertShadowPriceProtocol(session, meter.estimateMessage);
	assert.equal(protocol.replaces, 2, "each segment transacted independently");
});

test("commitClearMind rejects ranges that split a tool-call/result pair", () => {
	const session = fixture();
	const meter = replicaMeter();
	const surface = session.surface.nodes as readonly number[];
	// surface: u1, a1(call), t1(result), atext, u2, a2(call), t2(result)
	// starting at the RESULT node splits the a1/t1 pair from its call
	const resultSeq = surface[2];
	assert.throws(
		() => commitClearMind({ session, meter, config, route }, resultSeq, surface[surface.length - 1], "## Notes\nshould not split a pair"),
		/may not start at seq .*split a tool-call\/result pair.*Nearest valid boundaries/
	);
});

test("commitClearMind rejects an end inside the in-flight step", () => {
	const session = fixture();
	const meter = replicaMeter();
	const assistant = createAssistantMessage({
		content: [{ type: "tool-call", id: ToolCallId("call-open"), name: "bash", arguments: "{}" }],
		source: { provider: "p", model: "m" }
	});
	session.append("assistant/message", { turn: 3, step: 1, message: assistant }, { surfaceOp: "append", sourceEventSeqs: [] });
	const surface = session.surface.nodes as readonly number[];
	const openSeq = surface[surface.length - 1];
	assert.throws(
		() => commitClearMind({ session, meter, config, route }, "first", openSeq, "## Notes\ncannot clear an open step"),
		/may not end at seq .*(split a tool-call\/result pair or the step is still open)/
	);
});

test("commitClearMind rejects floors: tiny ranges, short notes, long notes, oversized notes", () => {
	const session = Session.create("s1" as never);
	appendTurn(session, 1, [{ user: "tiny session" }, { text: "tiny reply" }]);
	session.append("turn/start", { turn: 2 });
	const meter = replicaMeter();
	const endSeq = session.surface.nodes[session.surface.nodes.length - 1];
	// default config: minClearTokens 1000 (note must clear minNotesChars=200 first)
	const defaultConfig = resolveConfig({}) as never;
	const longEnough = "## Notes\n" + "user intent, key facts, abandoned paths, and the next step. ".repeat(5);
	assert.ok(longEnough.length >= 200);
	assert.throws(
		() => commitClearMind({ session, meter, config: defaultConfig, route }, "first", endSeq, longEnough),
		/only weighs ~\d+ tokens/
	);
	// small floor but short notes
	assert.throws(
		() => commitClearMind({ session, meter, config, route }, "first", endSeq, "short"),
		/notes are too short/
	);
	// oversized notes
	assert.throws(
		() => commitClearMind({ session, meter, config, route }, "first", endSeq, "x".repeat(20000)),
		/notes are too long/
	);
});

test("commitClearMind rejects notes larger than the cleared span", () => {
	const session = Session.create("s1" as never);
	appendTurn(session, 1, [
		{ user: "medium session " + LOREM.repeat(8) },
		{ calls: [{ name: "bash", result: LOREM.repeat(8) }] }
	]);
	session.append("turn/start", { turn: 2 });
	const meter = replicaMeter();
	const endSeq = session.surface.nodes[session.surface.nodes.length - 1];
	assert.throws(
		() => commitClearMind({ session, meter, config, route }, "first", endSeq, LOREM.repeat(120)),
		/would not be smaller than the cleared span/
	);
});

test("commitClearMind rejects unknown seqs and inverted positions", () => {
	const session = fixture();
	const meter = replicaMeter();
	const surface = session.surface.nodes as readonly number[];
	assert.throws(
		() => commitClearMind({ session, meter, config, route }, 99999, surface[0], "## Notes\nbad seq"),
		/not on the current surface/
	);
	assert.throws(
		() => commitClearMind({ session, meter, config, route }, surface[3], surface[1], "## Notes\ninverted"),
		/comes after end seq/
	);
});

test("commitClearMind rejects when no turn is open and when a compaction is already active", () => {
	const session = Session.create("s1" as never);
	appendTurn(session, 1, [{ user: "closed turn " + LOREM.repeat(10) }]);
	const meter = replicaMeter();
	const endSeq = session.surface.nodes[session.surface.nodes.length - 1];
	assert.throws(
		() => commitClearMind({ session, meter, config, route }, "first", endSeq, "## Notes\nno open turn"),
		/no open turn/
	);
	// open a turn, then simulate a live engine bracket
	session.append("turn/start", { turn: 2 });
	session.append("compaction/start", { compactionId: "locked" as never, turn: 2 });
	assert.throws(
		() => commitClearMind({ session, meter, config, route }, "first", endSeq, "## Notes\nbusy"),
		/another compaction is in progress/
	);
});

test("resolveConfig validates thresholds", () => {
	assert.throws(() => resolveConfig({ minClearTokens: 0 }), /positive integers/);
	assert.throws(() => resolveConfig({ minNotesChars: 500, maxNotesChars: 100 }), /less than maxNotesChars/);
	const resolved = resolveConfig({});
	assert.equal(resolved.minClearTokens, 1000);
	assert.equal(resolved.selfCollapse, true);
});

test("B1 regression: checkpoint source compactionId matches the transaction compactionId", () => {
	const session = fixture();
	const meter = replicaMeter();
	const endSeq = session.surface.nodes[session.surface.nodes.length - 1];
	commitClearMind({ session, meter, config, route }, "first", endSeq, "## Notes\napproach A findings for the future");
	const events = eventsOf(session);
	const summaryEvent = events.find((event) => event.type === "compaction/summary");
	assert.ok(summaryEvent !== undefined);
	const checkpointEvent = events.find((event) => event.type === "user/message" && (event as { surfaceOp?: { op?: string } }).surfaceOp?.op === "replace");
	assert.ok(checkpointEvent !== undefined);
	const source = (checkpointEvent.data as { source: { compactionId?: string } }).source;
	assert.equal(source.compactionId, summaryEvent.data.compactionId, "GUI aggregates compaction rows by this identity");
});

test("S4: a failing append closes the bracket with exactly one compaction/end carrying the error", () => {
	const session = fixture();
	const meter = replicaMeter();
	const endSeq = session.surface.nodes[session.surface.nodes.length - 1];
	// Break the second append (compaction/summary) to force the fail-closed path.
	const originalAppend = session.append.bind(session);
	let appends = 0;
	const breakingAppend = (type: string, data: unknown, options?: unknown) => {
		appends += 1;
		if (appends === 2) throw new Error("injected summary failure");
		return (originalAppend as unknown as (t: string, d: unknown, o?: unknown) => { seq: number })(type, data, options);
	};
	(session as unknown as { append: unknown }).append = breakingAppend;
	assert.throws(
		() => commitClearMind({ session, meter, config, route }, "first", endSeq, "## Notes\nvalid notes for the failure path"),
		/injected summary failure/
	);
	(session as unknown as { append: typeof originalAppend }).append = originalAppend;
	const events = eventsOf(session);
	// exact order after the failure: start, then end-with-error
	assert.equal(events[events.length - 2].type, "compaction/start");
	assert.equal(events[events.length - 1].type, "compaction/end");
	const endData = events[events.length - 1].data as { error?: string };
	assert.match(endData.error ?? "", /injected summary failure/);
	// the surface was never replaced
	const surface = session.surface.nodes as readonly number[];
	assert.ok(surface.includes(endSeq), "cleared span untouched");
	// and a subsequent commit can proceed once the bracket is closed
	session.append("turn/start", { turn: 99 });
	const retry = commitClearMind({ session, meter, config, route }, "first", endSeq, "## Notes\nretry after fail-closed close");
	assert.equal(retry.kind, "cleared");
	const protocol = assertShadowPriceProtocol(session, meter.estimateMessage);
	assert.equal(protocol.replaces, 1);
});

test("commitClearMind accepts string seq numbers, trimmed strings, and uppercase sentinels", () => {
	const session = fixture();
	const meter = replicaMeter();
	const surfaceBefore = [...session.surface.nodes];
	const endSeq = surfaceBefore[surfaceBefore.length - 1];
	// pass string numbers "0" or " 0 " as start, and "LATEST" as end
	const report = commitClearMind({ session, meter, config, route }, String(surfaceBefore[0]) as any, "LATEST" as any,
		"## Mission\n- make the build green\n## Notes\ntesting tolerant endpoints");
	assert.equal(report.kind, "cleared");
	assert.equal(report.clearedNodes, surfaceBefore.length);
});
