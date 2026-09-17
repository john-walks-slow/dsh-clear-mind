/**
 * Proactive reminder engine: nudge the model toward clearing its mind when
 * the context grows long or a single turn runs too many steps.
 *
 * The engine is stateless in the sense that all per-agent tracking lives in a
 * WeakMap and is cheap to lose; detection is a pure function of (config,
 * measurement, turn, step, prior-state). It runs inside the agent/pre-step
 * waterfall AFTER downstream listeners, so the decision it folds its message
 * into is the one the loop actually enters.
 *
 * Throttling: after a reminder fires, the same turn must advance by at least
 * `reminderStepInterval` steps before the next one, and the token count must
 * have grown — a steady-state conversation that neither adds steps nor grows
 * tokens never re-triggers.
 */

import type { Agent } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { MeterPort } from "./scan.js";
import { tryAgentRoute } from "./route.js";
import type { ClearMindConfig } from "./config.js";

/** Port for resolving the routed model's context window. */
export interface ModelInfoPort {
	resolveContextWindow(provider: string, model: string, signal: AbortSignal): Promise<number | undefined>;
}

/** Per-agent reminder tracking state (WeakMap-managed, lifecycle = agent). */
export interface AgentReminderState {
	lastRemindedTurn: number;
	lastRemindedStep: number;
	lastRemindedTokens: number;
}

/** One fired reminder with the reasons and metrics that triggered it. */
export interface ReminderTrigger {
	readonly reasons: readonly string[];
	readonly turn: number;
	readonly step: number;
	readonly totalTokens: number;
	readonly contextWindow: number | undefined;
}

const PLUGIN_NAME = "dsh-clear-mind";

/** Build the `<system-reminder>` text the model sees. */
function renderReminderText(trigger: ReminderTrigger): string {
	const lines: string[] = [
		"<system-reminder>",
		"[Context / Step Alert] 当前会话已达到主动清理检查点：",
		"- 原因：" + trigger.reasons.join("；"),
		"- 建议：长上下文或单轮过多 Step 容易累积过时试错过程与冗余工具输出，分散注意力并增加推理成本。",
		"- 行动指引：先调用 mind_map 审视当前上下文表面，然后将已完成阶段/可收敛支线通过 clear_mind 压缩为检查点，剔除噪音留下有用信息。若手头工作尚未完成，先把这一阶段的工作做完再清理即可。",
		"</system-reminder>"
	];
	return lines.join("\n");
}

/** Build the UserMessage for a fired reminder. */
export function buildReminderMessage(trigger: ReminderTrigger): UserMessage {
	return createUserMessage({
		content: [{ type: "text", text: renderReminderText(trigger) }],
		source: {
			kind: "plugin",
			plugin: PLUGIN_NAME,
			form: "notice",
			summary: "clear-mind proactive reminder"
		} as const
	});
}

/**
 * Evaluate whether a proactive reminder should fire for this agent at this
 * step. Returns a trigger (with reasons) when it should, or null when it
 * should not (disabled, below threshold, in cooldown, or route unresolved).
 *
 * @param config - live config snapshot (mutated in place by settings hot-reload).
 * @param agent  - the calling root agent.
 * @param meter  - token meter port for measuring the session surface.
 * @param modelInfo - port for resolving the routed model's context window.
 * @param turn   - current turn number (from the pre-step payload).
 * @param step   - current step number (from the pre-step payload).
 * @param signal - cancellation signal from the pre-step payload.
 * @param states - WeakMap tracking per-agent reminder state (caller-owned).
 * @returns a trigger with reasons, or null.
 */
export async function evaluateReminder(
	config: ClearMindConfig,
	agent: Agent,
	meter: MeterPort,
	modelInfo: ModelInfoPort,
	turn: number,
	step: number,
	signal: AbortSignal,
	states: WeakMap<Agent, AgentReminderState>
): Promise<ReminderTrigger | null> {
	if (!config.reminderEnabled) return null;
	if (signal.aborted) return null;

	const measurement = meter.measure(agent.session);
	const totalTokens = measurement.totalTokens;

	const route = tryAgentRoute(agent);
	if (route === undefined) return null;

	let contextWindow: number | undefined;
	try {
		contextWindow = await modelInfo.resolveContextWindow(route.provider, route.model, signal);
	} catch {
		contextWindow = undefined;
	}
	if (signal.aborted) return null;

	const reasons: string[] = [];

	// Condition A: step count exceeded.
	if (step >= config.reminderThresholdSteps) {
		reasons.push(`当前轮次已执行 ${step} 步（阈值 ${config.reminderThresholdSteps} 步）`);
	}

	// Condition B: token pressure exceeded.
	if (config.reminderThresholdTokens > 0 && totalTokens >= config.reminderThresholdTokens) {
		reasons.push(`上下文已达 ~${totalTokens} tokens（绝对阈值 ${config.reminderThresholdTokens}）`);
	}
	if (contextWindow !== undefined && contextWindow > 0) {
		const ratio = totalTokens / contextWindow;
		if (ratio >= config.reminderThresholdRatio) {
			const pct = Math.round(ratio * 100);
			reasons.push(`上下文已占模型窗口的 ${pct}%（${totalTokens}/${contextWindow} tokens，阈值 ${Math.round(config.reminderThresholdRatio * 100)}%）`);
		}
	}

	if (reasons.length === 0) return null;

	// Cooldown: same turn must advance by at least reminderStepInterval steps,
	// and the token count must have grown (a steady surface never re-triggers).
	const prior = states.get(agent);
	if (prior !== undefined) {
		if (prior.lastRemindedTurn === turn) {
			const stepGap = step - prior.lastRemindedStep;
			if (stepGap < config.reminderStepInterval) return null;
			if (totalTokens <= prior.lastRemindedTokens) return null;
		}
	}

	const trigger: ReminderTrigger = { reasons, turn, step, totalTokens, contextWindow };
	states.set(agent, {
		lastRemindedTurn: turn,
		lastRemindedStep: step,
		lastRemindedTokens: totalTokens
	});
	return trigger;
}
