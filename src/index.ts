/**
 * dsh-clear-mind — model-autonomous context compaction for DeepSeek Harness.
 *
 * Two exclusive tools for every ROOT agent:
 *   - mind_map: survey the agent's own model-visible surface (seqs, roles,
 *     token weights, valid clear boundaries, prior checkpoints).
 *   - clear_mind: replace a chosen surface span with a checkpoint the model
 *     itself distills, through the platform's native compaction transaction
 *     (start / summary / replace / end) so the GUI, token meter, and future
 *     auto-compactions all understand it.
 * Plus a step-boundary self-collapse that folds each clear_mind call+result
 * into a one-line tombstone once the checkpoint has landed, and a proactive
 * reminder that nudges the model when the context grows long or a turn runs
 * too many steps. The clear-mind playbook (when to clear, how to pick a
 * range and write the notes) is folded into the mind_map tool description
 * and result so no separate skill needs to be read first.
 *
 * Human-side history is never touched: the append-only log is the source of
 * truth and the GUI transcript renders append-origin events, so every clear
 * stays fully reviewable and reversible by the human.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { Volatile } from "@deepseek-ai/cosmokit";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import { Config, resolveConfig } from "./config.js";
import type { ClearMindConfig } from "./config.js";
import type { MeterPort } from "./scan.js";
import { mindMapTool, clearMindTool } from "./tools.js";
import { collapseClearMindRuns } from "./collapse.js";
import { evaluateReminder, buildReminderMessage } from "./reminder.js";
import type { AgentReminderState, ModelInfoPort } from "./reminder.js";
import { resolvePlaybook } from "./prompts.js";

export const name = "dsh-clear-mind";
export const inject = ["tools", "tokenMeter", "agents", "llm"];
export { Config };

/**
 * The validated live config the platform hands to apply — every knob the
 * settings page edits arrives as a Volatile<T> reference the loader commits
 * in place (loader/volatile-update), so reads below always observe the
 * current value without a restart or a watch callback. Plain (non-volatile)
 * fields — the playbook text overrides — are read once from the composition.
 */
interface LiveConfig {
	readonly minClearTokens: Volatile<number>;
	readonly minNotesChars: Volatile<number>;
	readonly maxNotesChars: Volatile<number>;
	readonly selfCollapse: Volatile<boolean>;
	readonly reminderEnabled: Volatile<boolean>;
	readonly reminderThresholdRatio: Volatile<number>;
	readonly reminderThresholdTokens: Volatile<number>;
	readonly reminderThresholdSteps: Volatile<number>;
	readonly reminderStepInterval: Volatile<number>;
	readonly playbook?: unknown;
	readonly presetPlaybook?: unknown;
}

/** Project the live volatile references onto a plain snapshot for one use. */
function snapshot(live: LiveConfig): ClearMindConfig {
	return resolveConfig({
		minClearTokens: live.minClearTokens.get(),
		minNotesChars: live.minNotesChars.get(),
		maxNotesChars: live.maxNotesChars.get(),
		selfCollapse: live.selfCollapse.get(),
		playbook: live.playbook as Record<string, unknown> | undefined,
		presetPlaybook: live.presetPlaybook as Record<string, Record<string, unknown>> | undefined,
		reminderEnabled: live.reminderEnabled.get(),
		reminderThresholdRatio: live.reminderThresholdRatio.get(),
		reminderThresholdTokens: live.reminderThresholdTokens.get(),
		reminderThresholdSteps: live.reminderThresholdSteps.get(),
		reminderStepInterval: live.reminderStepInterval.get()
	});
}

export function apply(ctx: Context, config: LiveConfig) {
	const meter: MeterPort = {
		measure: (session) => ctx.tokenMeter.measure(session),
		estimateMessage: (message) => ctx.tokenMeter.estimateMessage(message)
	};
	const modelInfo: ModelInfoPort = {
		resolveContextWindow: async (provider, model, signal) => {
			try {
				const info = await ctx.llm.resolveModelInfo(provider, model, signal);
				return info?.context?.contextWindow;
			} catch {
				return undefined;
			}
		}
	};
	const reminderStates = new WeakMap<Agent, AgentReminderState>();

	// Register both tools on every root agent exactly once. Subagents keep the
	// platform's automatic compaction only — their context is short-lived by
	// design and scoped delegation should not rewrite its own history.
	//
	// The prompt wording is resolved once per agent registration from the
	// operator's overrides — `presetPlaybook[agentPreset]` first, then the
	// global `playbook`, then the built-in text. A preset is durable per
	// session, so the resolved wording is captured at registration time;
	// ordinary-config edits remount the plugin, volatile edits need no
	// re-registration (tool closures read a fresh snapshot per call).
	const registered = new WeakSet<Agent>();
	const liveSnapshot = (): ClearMindConfig => snapshot(config);
	const registerOne = (agent: Agent) => {
		if (registered.has(agent)) return;
		if (!ctx.agents.roots().includes(agent)) return;
		registered.add(agent);
		const read = liveSnapshot();
		const prompts = resolvePlaybook(read, agent.session.header.agentPreset);
		agent.ctx.tools.register(mindMapTool(meter, prompts));
		// The tool closures read a fresh snapshot per execution so
		// settings-page writes apply without re-registration or restart.
		agent.ctx.tools.register(clearMindTool(meter, liveSnapshot));
	};
	ctx.on("agent/created", async ({ agent }: { agent: Agent }) => {
		registerOne(agent);
	});
	for (const existing of ctx.agents.roots()) {
		registerOne(existing);
	}

	// Optional settings namespace registration: lets the Web UI read and
	// hot-edit every volatile config knob without a restart. On 0.1.7+ the
	// settings service discovers forms from the plugin Config schema
	// automatically (fields marked .volatile()), so the host side only
	// declares its page policy; on older platforms without the new service
	// this degrades to a logged no-op. Business reads go through the live
	// ctx.config references directly (Volatile<T>.get()), and updates arrive
	// via loader/volatile-update.
	ctx.inject(["settings"], (child) => {
		child.effect(() => (child as unknown as { settings: { configure: (p: { auto: boolean }, owner?: unknown) => () => void } }).settings.configure({ auto: false }, ctx.fiber));
	});

	// Self-collapse + proactive reminder at the step boundary. The self-collapse
	// runs BEFORE next() (it mutates the surface the downstream listeners see);
	// the reminder runs AFTER next() (it folds its message into the enter
	// decision the loop is about to execute).
	ctx.on("agent/pre-step", async (
		payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
		next: () => Promise<PreStepDecision>
	): Promise<PreStepDecision> => {
		// Self-collapse: fold every completed clear_mind call+result pair.
		if (liveSnapshot().selfCollapse && registered.has(payload.agent)) {
			try {
				collapseClearMindRuns(payload.agent.session, meter);
			} catch (error) {
				ctx.logger.warn("dsh-clear-mind: self-collapse skipped (" + (error instanceof Error ? error.message : String(error)) + ")");
			}
		}
		const decision = await next();
		if (decision.kind === "reject" || payload.signal.aborted) return decision;
		if (!registered.has(payload.agent)) return decision;
		// Proactive reminder: nudge the model when context is long or a turn
		// has run too many steps.
		try {
			const read = liveSnapshot();
			const trigger = await evaluateReminder(
				read, payload.agent, meter, modelInfo,
				payload.turn, payload.step, payload.signal, reminderStates
			);
			if (trigger !== null) {
				const prompts = resolvePlaybook(read, payload.agent.session.header.agentPreset);
				return { ...decision, messages: [...decision.messages, buildReminderMessage(trigger, prompts)] };
			}
		} catch (error) {
			ctx.logger.warn("dsh-clear-mind: reminder evaluation skipped (" + (error instanceof Error ? error.message : String(error)) + ")");
		}
		return decision;
	});

	ctx.logger.info("dsh-clear-mind: registered mind_map + clear_mind for root agents; clear-mind playbook folded into mind_map");
}
