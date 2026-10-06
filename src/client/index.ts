/**
 * dsh-clear-mind client half: registers the Clear Mind settings page as a
 * settings.section contribution in the DSH Web settings shell.
 *
 * The page binds the entry-id settings namespace through a `configForms`
 * form and renders a form for every volatile configuration knob. Saves
 * hot-apply without a restart — the host loader commits volatile values
 * into the running config references (loader/volatile-update).
 *
 * The entry id is NOT "clear-mind": on 0.1.7+ the settings service keys
 * forms by the profile entry id (`- id: clear-mind` in cordis.patch.yml),
 * so the page follows the served namespace via whileServed and stays hidden
 * on deployments that never composed this plugin.
 */

import * as React from "react";
import { SettingsPanel } from "./settings-panel.js";
import type { ClearMindSettings, SettingsScope } from "./settings-panel.js";
import type { SettingsSectionOwnerProps } from "@deepseek-ai/dsh-client-ui-settings/client";

/** This plugin's profile entry id (cordis.patch.yml `- id: clear-mind`). */
const ENTRY_ID = "clear-mind";

/** Minimal structural client context (the shell binds these services). */
interface SlotEntry {
	name: string;
	id: string;
	order: number;
	label: () => string;
	locale?: string;
	inject?: () => Record<string, unknown>;
}

interface ClientCtx {
	effect(dispose: () => () => void): () => void;
	slots: {
		inject(id: string, factory: () => () => void): () => void;
		register<T extends SlotEntry>(entry: T, component: React.ComponentType<SettingsSectionOwnerProps & ReturnType<NonNullable<T["inject"]>>>): () => void;
	};
	configForms: {
		get(namespace: string): SettingsScope<ClearMindSettings>;
		whileServed(namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void): () => void;
	};
}

export const inject = ["slots", "configForms"];

export function apply(ctx: ClientCtx): void {
	const form = ctx.configForms.get(ENTRY_ID);
	ctx.effect(() => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject(
		"settings.section",
		() => ctx.slots.register(
			{
				name: "settings.section",
				id: "clear-mind",
				order: 125,
				label: () => "Clear Mind",
				inject: () => ({
					scope: form
				})
			},
			SettingsPanel
		)
	)));
}