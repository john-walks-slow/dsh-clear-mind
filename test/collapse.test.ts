import { test } from "node:test";
import assert from "node:assert/strict";
import { Session, SessionSeq, deriveEventMessage } from "@deepseek-ai/dsh-session";
import { toolPairingBalancedAfter, toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";
import { commitClearMind } from "../src/commit.js";
import { applyCollapse, collapseClearMindRuns, collapseToolName, planCollapses, tombstoneText } from "../src/collapse.js";
import { appendOpenAssistant, appendToolResult, appendTurn, assertShadowPriceProtocol, eventsOf, replicaMeter } from "./helpers.js";

const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ";
const config = { minClearTokens: 1, minNotesChars: 10, maxNotesChars: 16000, selfCollapse: true } as never;
const route = { provider: "test-provider", model: "test-model" };

/**
 * Realistic clear_mind flow: completed history turns, an open turn whose
 * assistant message carries a solo clear_mind call, commit, then the tool
 * result lands (as the agent loop would after execute returns).
 */
function commitFlow() {
	const session = Session.create("s1" as never);
	appendTurn(session, 1, [
		{ user: "explore " + LOREM.repeat(20) },
		{ calls: [{ name: "bash", result: LOREM.repeat(60) }] }
	]);
	session.append("turn/start", { turn: 2 });
	const meter = replicaMeter();
	const assistant = appendOpenAssistant(session, 2, [{ name: "clear_mind" }]);
	const report = commitClearMind(
		{ session, meter, config, route },
		"first", "latest",
		"## Mission\n- finish the feature\n## Abandoned\n- approach A: flaky"
	);
	appendToolResult(session, 2, 2, assistant, 0, "Cleared " + report.clearedNodes + " messages.", {
		meta: { clearedNodes: report.clearedNodes, clearedTokens: report.clearedTokens, checkpointSeq: report.checkpointSeq }
	});
	return { session, meter, assistant, report };
}

test("planCollapses finds a solo successful clear_mind run", () => {
	const { session, meter, report } = commitFlow();
	const plans = planCollapses(session, meter);
	assert.equal(plans.length, 1);
	const plan = plans[0];
	assert.equal(plan.assistantSeq, session.surface.nodes[session.surface.nodes.length - 2]);
	assert.equal(plan.resultSeqs.length, 1);
	assert.deepEqual(plan.stats, { clearedNodes: report.clearedNodes, clearedTokens: report.clearedTokens, checkpointSeq: report.checkpointSeq });
	assert.ok(plan.shadowedTokenCount > 0);
});

test("applyCollapse replaces the pair with a visible user-notice tombstone and honors the shadow-price protocol", () => {
	const { session, meter, report } = commitFlow();
	const before = session.surface.nodes as readonly number[];
	const assistantSeq = before[before.length - 2];
	const resultSeq = before[before.length - 1];
	const tombstoneSeqs = collapseClearMindRuns(session, meter);
	assert.equal(tombstoneSeqs.length, 1);
	const after = session.surface.nodes as readonly number[];
	assert.ok(!after.includes(assistantSeq), "assistant call node is gone");
	assert.ok(!after.includes(resultSeq), "result node is gone");
	const tombstoneEvent = session.eventAt(SessionSeq(tombstoneSeqs[0]));
	assert.ok(tombstoneEvent !== undefined && tombstoneEvent.type === "user/message", "tombstone is a user-role notice");
	const message = deriveEventMessage(tombstoneEvent);
	assert.ok(message !== null, "tombstone derives to a visible message");
assert.equal((tombstoneEvent.data as { source: { kind: string; plugin: string } }).source.plugin, "dsh-clear-mind");
	assert.match((message.content[0] as { text: string }).text, new RegExp("clear-mind: cleared " + report.clearedNodes + " messages \\(~" + report.clearedTokens + " tokens\\) into checkpoint seq"));
	// pairing stays balanced across the whole surface after the collapse
	for (const seq of after) {
		assert.equal(toolPairingBalancedBefore(session, SessionSeq(seq)), true, "balancedBefore at " + seq);
		assert.equal(toolPairingBalancedAfter(session, SessionSeq(seq)), true, "balancedAfter at " + seq);
	}
	// the tombstone transaction itself follows the shadow-price protocol
	const protocol = assertShadowPriceProtocol(session, meter.estimateMessage);
	assert.equal(protocol.replaces, 2, "commit + collapse replacements");
	// idempotent: a second scan finds nothing left to collapse
	assert.equal(planCollapses(session, meter).length, 0);
});

test("tombstone text without meta stays generic but informative", () => {
	const text = tombstoneText(undefined);
	assert.match(text, /clear-mind: checkpoint committed/);
	assert.match(text, /<compacted-summary>/);
});

test("mixed batches and failed results never collapse", () => {
	// mixed: clear_mind + bash in one assistant message
	const session = Session.create("s1" as never);
	appendTurn(session, 1, [{ user: "history " + LOREM.repeat(20) }]);
	session.append("turn/start", { turn: 2 });
	const meter = replicaMeter();
	const assistant = appendOpenAssistant(session, 2, [{ name: "clear_mind" }, { name: "bash" }]);
	commitClearMind({ session, meter, config, route }, "first", "latest", "## Notes\nhistory distilled");
	appendToolResult(session, 2, 2, assistant, 0, "Cleared.");
	appendToolResult(session, 2, 2, assistant, 1, "bash output");
	assert.equal(planCollapses(session, meter).length, 0, "mixed batch is skipped");

	// failed clear_mind result is kept for the model to read
	const session2 = Session.create("s2" as never);
	appendTurn(session2, 1, [{ user: "history " + LOREM.repeat(20) }]);
	session2.append("turn/start", { turn: 2 });
	const meter2 = replicaMeter();
	const assistant2 = appendOpenAssistant(session2, 2, [{ name: "clear_mind" }]);
	commitClearMind({ session: session2, meter: meter2, config, route }, "first", "latest", "## Notes\nwill fail on purpose");
	appendToolResult(session2, 2, 2, assistant2, 0, "clear_mind: notes are too short", { isError: true });
	assert.equal(planCollapses(session2, meter2).length, 0, "failed result is skipped");
});

test("an older uncollapsed pair (mid-surface) still collapses later", () => {
	const { session, meter } = commitFlow();
	// the turn moves on: more work lands after the clear_mind exchange
	appendTurn(session, 3, [{ user: "next task " + LOREM.repeat(5) }, { text: "working" }]);
	session.append("turn/start", { turn: 4 });
	const plans = planCollapses(session, meter);
	assert.equal(plans.length, 1, "the pair is found mid-surface");
	const tombstoneSeqs = collapseClearMindRuns(session, meter);
	assert.equal(tombstoneSeqs.length, 1);
	assert.equal(planCollapses(session, meter).length, 0);
	const protocol = assertShadowPriceProtocol(session, meter.estimateMessage);
	assert.equal(protocol.replaces, 2);
});

test("collapseToolName exposes the recognized tool", () => {
	assert.equal(collapseToolName(), "clear_mind");
});
