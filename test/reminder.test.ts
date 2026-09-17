/**
 * Unit tests for the proactive reminder engine (src/reminder.ts).
 *
 * The engine is exercised with minimal fakes: a shell Agent carrying only the
 * route fields evaluateReminder reads, a meter stub returning a fixed token
 * total, and a model-info stub for the context window. All trigger/cooldown
 * behavior is asserted against raw config values so no session transcript is
 * needed.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { TokenMeasurement } from "@deepseek-ai/dsh-token-meter";
import { resolveConfig } from "../src/config.js";
import { evaluateReminder, buildReminderMessage } from "../src/reminder.js";
import type { ModelInfoPort } from "../src/reminder.js";
import type { MeterPort } from "../src/scan.js";

/** A minimal agent-shaped object: only the fields routeOf touches. */
function fakeAgent(route?: { provider: string; model: string }): Agent {
	const agent = {
		session: {
			requestHeader: () => (route === undefined ? undefined : { config: route })
		},
		options: route ?? {}
	};
	return agent as unknown as Agent;
}

/** A meter stub that reports a fixed token total. */
function fakeMeter(totalTokens: number): MeterPort {
	return {
		measure: () => ({ totalTokens } as unknown as TokenMeasurement),
		estimateMessage: () => 0
	};
}

/** A model-info stub that resolves a fixed context window (or throws). */
function fakeModelInfo(contextWindow: number | undefined | (() => never)): ModelInfoPort {
	return {
		resolveContextWindow: async () => {
			if (typeof contextWindow === "function") return contextWindow();
			return contextWindow;
		}
	};
}

function freshSignal(): AbortSignal {
	return new AbortController().signal;
}

test("resolveConfig defaults: the step threshold is 100 steps with a 25-step cooldown", () => {
	const config = resolveConfig();
	assert.equal(config.reminderThresholdSteps, 100);
	assert.equal(config.reminderStepInterval, 25);
});

test("evaluateReminder fires when the step count crosses the threshold", async () => {
	const config = resolveConfig({ reminderThresholdSteps: 15 });
	const agent = fakeAgent({ provider: "p", model: "m" });
	const states = new WeakMap();
	const trigger = await evaluateReminder(config, agent, fakeMeter(500), fakeModelInfo(100000), 1, 15, freshSignal(), states);
	assert.ok(trigger !== null);
	assert.ok(trigger.reasons.some((reason) => reason.includes("步")));
	assert.equal(trigger.turn, 1);
	assert.equal(trigger.step, 15);
});

test("evaluateReminder stays silent below every threshold", async () => {
	const config = resolveConfig({ reminderThresholdSteps: 100, reminderThresholdTokens: 0, reminderThresholdRatio: 0.9 });
	const agent = fakeAgent({ provider: "p", model: "m" });
	const states = new WeakMap();
	const trigger = await evaluateReminder(config, agent, fakeMeter(100), fakeModelInfo(100000), 1, 2, freshSignal(), states);
	assert.equal(trigger, null);
});

test("a second reminder within the cooldown window is throttled", async () => {
	const config = resolveConfig({ reminderThresholdSteps: 10, reminderStepInterval: 5 });
	const agent = fakeAgent({ provider: "p", model: "m" });
	const states = new WeakMap();
	const signal = freshSignal();
	const first = await evaluateReminder(config, agent, fakeMeter(500), fakeModelInfo(100000), 1, 10, signal, states);
	assert.ok(first !== null);
	// Same turn, +2 steps, tokens grew — but the 5-step cooldown is not spent.
	const second = await evaluateReminder(config, agent, fakeMeter(900), fakeModelInfo(100000), 1, 12, signal, states);
	assert.equal(second, null);
});

test("after the cooldown the reminder can fire again when tokens grew", async () => {
	const config = resolveConfig({ reminderThresholdSteps: 10, reminderStepInterval: 5 });
	const agent = fakeAgent({ provider: "p", model: "m" });
	const states = new WeakMap();
	const signal = freshSignal();
	const first = await evaluateReminder(config, agent, fakeMeter(500), fakeModelInfo(100000), 1, 10, signal, states);
	assert.ok(first !== null);
	const second = await evaluateReminder(config, agent, fakeMeter(900), fakeModelInfo(100000), 1, 12, signal, states);
	assert.equal(second, null);
	const third = await evaluateReminder(config, agent, fakeMeter(1200), fakeModelInfo(100000), 1, 17, signal, states);
	assert.ok(third !== null);
});

test("a steady surface past the cooldown still stays silent (tokens must grow)", async () => {
	const config = resolveConfig({ reminderThresholdSteps: 10, reminderStepInterval: 5 });
	const agent = fakeAgent({ provider: "p", model: "m" });
	const states = new WeakMap();
	const signal = freshSignal();
	const first = await evaluateReminder(config, agent, fakeMeter(500), fakeModelInfo(100000), 1, 10, signal, states);
	assert.ok(first !== null);
	// Step gap satisfied, but the token count did not advance.
	const next = await evaluateReminder(config, agent, fakeMeter(500), fakeModelInfo(100000), 1, 17, signal, states);
	assert.equal(next, null);
});

test("a new turn resets the cooldown", async () => {
	const config = resolveConfig({ reminderThresholdSteps: 10, reminderStepInterval: 5 });
	const agent = fakeAgent({ provider: "p", model: "m" });
	const states = new WeakMap();
	const signal = freshSignal();
	const first = await evaluateReminder(config, agent, fakeMeter(500), fakeModelInfo(100000), 1, 10, signal, states);
	assert.ok(first !== null);
	// Turn 2 immediately at threshold: different turn, so no cooldown applies.
	const second = await evaluateReminder(config, agent, fakeMeter(600), fakeModelInfo(100000), 2, 10, signal, states);
	assert.ok(second !== null);
});

test("the absolute token threshold triggers with a reason", async () => {
	const config = resolveConfig({ reminderThresholdTokens: 8000, reminderThresholdSteps: 100 });
	const agent = fakeAgent({ provider: "p", model: "m" });
	const states = new WeakMap();
	const trigger = await evaluateReminder(config, agent, fakeMeter(9000), fakeModelInfo(undefined), 1, 3, freshSignal(), states);
	assert.ok(trigger !== null);
	assert.ok(trigger.reasons.some((reason) => reason.includes("绝对阈值")));
});

test("the ratio threshold triggers against the resolved context window", async () => {
	const config = resolveConfig({ reminderThresholdRatio: 0.7, reminderThresholdTokens: 0, reminderThresholdSteps: 100 });
	const agent = fakeAgent({ provider: "p", model: "m" });
	const states = new WeakMap();
	const trigger = await evaluateReminder(config, agent, fakeMeter(7000), fakeModelInfo(10000), 1, 2, freshSignal(), states);
	assert.ok(trigger !== null);
	assert.ok(trigger.reasons.some((reason) => reason.includes("70%")));
});

test("reminderEnabled:false stays silent even at extreme values", async () => {
	const config = resolveConfig({ reminderEnabled: false });
	const agent = fakeAgent({ provider: "p", model: "m" });
	const states = new WeakMap();
	const trigger = await evaluateReminder(config, agent, fakeMeter(999999), fakeModelInfo(1000), 1, 999, freshSignal(), states);
	assert.equal(trigger, null);
});

test("an unresolved route stays silent", async () => {
	const config = resolveConfig({});
	const agent = fakeAgent(undefined);
	const states = new WeakMap();
	const trigger = await evaluateReminder(config, agent, fakeMeter(100), fakeModelInfo(200), 1, 99, freshSignal(), states);
	assert.equal(trigger, null);
});

test("an aborted signal stays silent", async () => {
	const config = resolveConfig({});
	const agent = fakeAgent({ provider: "p", model: "m" });
	const states = new WeakMap();
	const controller = new AbortController();
	controller.abort();
	const trigger = await evaluateReminder(config, agent, fakeMeter(100), fakeModelInfo(200), 1, 99, controller.signal, states);
	assert.equal(trigger, null);
});

test("a failing context-window resolution degrades to the step reason only", async () => {
	const config = resolveConfig({ reminderThresholdSteps: 5 });
	const agent = fakeAgent({ provider: "p", model: "m" });
	const states = new WeakMap();
	const trigger = await evaluateReminder(config, agent, fakeMeter(100), fakeModelInfo(() => {
		throw new Error("boom");
	}), 1, 5, freshSignal(), states);
	assert.ok(trigger !== null);
	assert.ok(trigger.reasons.some((reason) => reason.includes("步")));
	assert.ok(!trigger.reasons.some((reason) => reason.includes("窗口")));
});

test("buildReminderMessage renders a system-reminder notice with the relaxed phase-first ending", () => {
	const message = buildReminderMessage({ reasons: ["测试原因"], turn: 1, step: 15, totalTokens: 500, contextWindow: undefined });
	const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
	assert.ok(text.includes("<system-reminder>"));
	assert.ok(text.includes("测试原因"));
	assert.ok(text.includes("</system-reminder>"));
	// the old "clear immediately after the atomic action" push is relaxed into
	// "finish the current phase first"
	assert.ok(text.includes("先把这一阶段的工作做完再清理"));
	assert.ok(!text.includes("立刻清理"));
	assert.equal(message.source.kind, "plugin");
});