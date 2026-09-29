/**
 * dsh-clear-mind client half: registers the Clear Mind settings page as a
 * settings.section contribution in the DSH Web settings shell.
 *
 * The page binds the `clear-mind` settings namespace through a
 * `configForms` form (the 0.1.7 replacement for the removed `settingsScope`
 * service) and renders a form for every configuration knob. Saves hot-apply
 * without a restart — the host-side watch callback mutates the live config
 * object.
 */

import * as React from "react";
import { SettingsPanel } from "./settings-panel.js";
import type { ClearMindSettings, SettingsScope } from "./settings-panel.js";
import type { SettingsSectionOwnerProps } from "@deepseek-ai/dsh-client-ui-settings/client";

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
	slots: {
		inject(id: string, factory: () => unknown): void;
		register<T extends SlotEntry>(entry: T, component: React.ComponentType<SettingsSectionOwnerProps & ReturnType<NonNullable<T["inject"]>>>): unknown;
	};
	configForms: {
		get(namespace: string): SettingsScope<ClearMindSettings>;
	};
}

export const inject = ["slots", "configForms"];

export function apply(ctx: ClientCtx): void {
	const form = ctx.configForms.get("clear-mind");
	ctx.slots.inject(
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
	);
}