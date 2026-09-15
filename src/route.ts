/**
 * Shared agent-route resolution: extract the durable provider/model route a
 * session is running on, for the meter's context-window lookup and the tool
 * layer's error reporting. requestHeader()?.config is the primary source;
 * agent.options is the fallback for test fixtures and headless sessions.
 */

import type { Agent } from "@deepseek-ai/dsh-agent";

/** Resolve the durable provider/model route for the calling agent's session. */
export function tryAgentRoute(agent: Agent): { provider: string; model: string } | undefined {
	const config = agent.session.requestHeader()?.config;
	if (config !== undefined && typeof config.provider === "string" && typeof config.model === "string") {
		return { provider: config.provider, model: config.model };
	}
	if (agent.options.provider !== undefined && agent.options.model !== undefined) {
		return { provider: agent.options.provider, model: agent.options.model };
	}
	return undefined;
}