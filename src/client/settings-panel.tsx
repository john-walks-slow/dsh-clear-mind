/**
 * The Clear Mind settings panel: a single settings.section contribution that
 * lets the user read, edit, and hot-save every configuration knob.
 *
 * Reads the current namespace snapshot through ctx.settingsScope, stages edits
 * locally, and writes each field through scope.set on Save. Reset clears the
 * override so the field re-inherits the composition default.
 */

import * as React from "react";
import type { SettingsScope, SettingsScopeSnapshot } from "@deepseek-ai/dsh-client-ui-settings/client";
import { installStyles } from "./styles.js";

/** The config shape (mirrors ClearMindConfig from config.ts). */
export interface ClearMindSettings {
	minClearTokens: number;
	minNotesChars: number;
	maxNotesChars: number;
	selfCollapse: boolean;
	reminderEnabled: boolean;
	reminderThresholdRatio: number;
	reminderThresholdTokens: number;
	reminderThresholdSteps: number;
	reminderStepInterval: number;
}

export type ClearMindScope = SettingsScope<ClearMindSettings>;
type Snapshot = SettingsScopeSnapshot<ClearMindSettings>;

interface FieldDef {
	key: keyof ClearMindSettings;
	label: string;
	hint: string;
	type: "number" | "toggle";
	min?: number;
	max?: number;
}

const FIELDS: { section: string; title: string; fields: FieldDef[] }[] = [
	{
		section: "reminder",
		title: "主动提醒 (Proactive Reminder)",
		fields: [
			{ key: "reminderEnabled", label: "启用主动提醒", hint: "当上下文过长或单轮步数过多时，自动提醒模型清理思路。", type: "toggle" },
			{ key: "reminderThresholdRatio", label: "上下文占比阈值", hint: "上下文占模型最大窗口的比例（0.01 ~ 1.0），如 0.90 = 90%。", type: "number", min: 0.01, max: 1 },
			{ key: "reminderThresholdTokens", label: "上下文绝对 Token 阈值", hint: "绝对 Token 数阈值（0 表示仅按比例计算）。", type: "number", min: 0 },
			{ key: "reminderThresholdSteps", label: "单轮最大 Step 步数", hint: "同一轮内连续执行的 Step 步数阈值（≥ 1）。", type: "number", min: 1 },
			{ key: "reminderStepInterval", label: "提醒冷却步数", hint: "同一轮内两次提醒之间的最小步数间隔（≥ 1）。", type: "number", min: 1 }
		]
	},
	{
		section: "guards",
		title: "压缩与检查点护栏 (Compaction Guards)",
		fields: [
			{ key: "minClearTokens", label: "最小清理 Token 数", hint: "被清区间 heuristic tokens 低于此值时不允许清理（防止琐碎清理）。", type: "number", min: 1 },
			{ key: "minNotesChars", label: "检查点笔记最小字数", hint: "检查点笔记的最小字符数，须小于最大字数。", type: "number", min: 1 },
			{ key: "maxNotesChars", label: "检查点笔记最大字数", hint: "检查点笔记的最大字符数，须大于最小字数。", type: "number", min: 1 }
		]
	},
	{
		section: "behavior",
		title: "运行时行为 (Runtime Behaviors)",
		fields: [
			{ key: "selfCollapse", label: "自动折叠 clear_mind 调用", hint: "将已提交的 clear_mind 调用与结果在下一步折叠为一行简报。", type: "toggle" }
		]
	}
];

const ALL_FIELDS: FieldDef[] = FIELDS.flatMap((group) => group.fields);

/** Check if a field is overridden (present in the raw user layer). */
function isOverridden(snapshot: Snapshot, key: string): boolean {
	const user = snapshot.user as Record<string, unknown> | undefined;
	return user !== undefined && key in user;
}

/** Parse a draft string into a value or undefined if invalid. */
function parseDraft(field: FieldDef, text: string): { value: number | boolean | undefined; error: string | null } {
	if (field.type === "toggle") {
		return { value: text === "true", error: null };
	}
	const num = Number(text);
	if (text === "" || !Number.isFinite(num)) return { value: undefined, error: "请输入有效的数字" };
	if (field.min !== undefined && num < field.min) return { value: undefined, error: `值不能小于 ${field.min}` };
	if (field.max !== undefined && num > field.max) return { value: undefined, error: `值不能大于 ${field.max}` };
	return { value: num, error: null };
}

/** Format a current value for display in an input. */
function formatValue(field: FieldDef, value: unknown): string {
	if (field.type === "toggle") return value === true ? "true" : "false";
	return typeof value === "number" ? String(value) : "";
}

/** One number field row. */
function NumberField(props: {
	field: FieldDef;
	draft: string;
	overridden: boolean;
	writable: boolean;
	saving: boolean;
	onDraft: (text: string) => void;
	onUnset: () => void;
}): React.ReactElement {
	const { field, draft, overridden, writable, saving, onDraft, onUnset } = props;
	const { error } = parseDraft(field, draft);
	const invalid = error !== null;
	return (
		<div className="dcm-field">
			<div className="dcm-field-head">
				<label className="dcm-field-label">{field.label}</label>
				<div className="dcm-field-badges">
					{overridden ? <span className="dcm-badge">已覆盖</span> : null}
					{overridden ? (
						<button type="button" className="dcm-reset" disabled={!writable || saving} onClick={onUnset}>
							重置
						</button>
					) : null}
				</div>
			</div>
			<input
				className={invalid ? "dcm-input dcm-inputInvalid" : "dcm-input"}
				type="text"
				inputMode="numeric"
				value={draft}
				disabled={!writable || saving}
				onChange={(event) => onDraft(event.target.value)}
			/>
			<p className={invalid ? "dcm-invalid" : "dcm-hint"}>{invalid ? error : field.hint}</p>
		</div>
	);
}

/** Props the settings shell supplies: close + the inject face (scope). */
export interface SettingsPanelProps {
	/** Close the settings panel (shell affordance). */
	close?: () => void;
	/** The bound `clear-mind` settings scope, from the slot inject face. */
	scope: ClearMindScope;
}

export function SettingsPanel(props: SettingsPanelProps): React.ReactElement {
	installStyles();
	const { scope } = props;
	const [snapshot, setSnapshot] = React.useState<Snapshot>(scope.getSnapshot());
	const [drafts, setDrafts] = React.useState<Partial<Record<keyof ClearMindSettings, string>>>({});
	const [saving, setSaving] = React.useState(false);
	const [feedback, setFeedback] = React.useState<{ kind: "ok" | "err" | "saved"; text: string } | null>(null);
	React.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);

	if (snapshot.status === "loading") return <div className="dcm-loading">正在加载设置…</div>;
	if (snapshot.status === "unavailable") return <div className="dcm-loading">设置不可用（内存模式或命名空间未注册）。</div>;

	const value = snapshot.value ?? ({} as ClearMindSettings);
	const writable = snapshot.writable;

	const draftOf = (field: FieldDef): string => drafts[field.key] ?? formatValue(field, value[field.key]);
	const isDirty = (field: FieldDef): boolean => {
		const draft = drafts[field.key];
		if (draft === undefined) return false;
		return parseDraft(field, draft).value !== value[field.key];
	};
	const hasInvalid = (field: FieldDef): boolean => {
		const draft = drafts[field.key];
		return draft !== undefined && parseDraft(field, draft).error !== null;
	};
	const setDraft = (field: FieldDef) => (text: string) => setDrafts((d) => ({ ...d, [field.key]: text }));

	/** Cross-field validation: minNotesChars must stay below maxNotesChars. */
	const crossFieldError = (): string | null => {
		const resolveField = (key: "minNotesChars" | "maxNotesChars"): number | undefined => {
			const field = ALL_FIELDS.find((candidate) => candidate.key === key);
			if (field === undefined) return undefined;
			const draft = drafts[key];
			if (draft !== undefined) {
				const parsed = parseDraft(field, draft);
				if (parsed.error !== null || parsed.value === undefined) return undefined;
				return typeof parsed.value === "number" ? parsed.value : undefined;
			}
			return typeof value[key] === "number" ? value[key] : undefined;
		};
		const min = resolveField("minNotesChars");
		const max = resolveField("maxNotesChars");
		if (min !== undefined && max !== undefined && min >= max) {
			return "检查点笔记最小字数必须小于最大字数（minNotesChars < maxNotesChars）。";
		}
		return null;
	};

	const handleSave = async () => {
		const crossError = crossFieldError();
		if (crossError !== null) {
			setFeedback({ kind: "err", text: crossError });
			return;
		}
		setSaving(true);
		setFeedback(null);
		try {
			let savedCount = 0;
			for (const group of FIELDS) {
				for (const field of group.fields) {
					if (!isDirty(field)) continue;
					const { value: parsed, error } = parseDraft(field, draftOf(field));
					if (error !== null || parsed === undefined) continue;
					await scope.set(field.key, parsed);
					savedCount++;
				}
			}
			setDrafts({});
			setFeedback({ kind: "saved", text: savedCount > 0 ? `已保存 ${savedCount} 项更改。` : "无需要保存的更改。" });
		} catch (err) {
			setFeedback({ kind: "err", text: "保存失败：" + (err instanceof Error ? err.message : String(err)) });
		} finally {
			setSaving(false);
		}
	};

	/** Per-field reset: clear the override AND the staged draft. */
	const handleResetField = async (field: FieldDef) => {
		setSaving(true);
		setFeedback(null);
		try {
			await scope.unset(field.key);
			setDrafts((d) => {
				const next = { ...d };
				delete next[field.key];
				return next;
			});
			setFeedback({ kind: "ok", text: `已将「${field.label}」恢复为默认值。` });
		} catch (err) {
			setFeedback({ kind: "err", text: "重置失败：" + (err instanceof Error ? err.message : String(err)) });
		} finally {
			setSaving(false);
		}
	};

	const handleResetAll = async () => {
		setSaving(true);
		setFeedback(null);
		try {
			for (const group of FIELDS) {
				for (const field of group.fields) {
					if (isOverridden(snapshot, field.key)) {
						await scope.unset(field.key);
					}
				}
			}
			setDrafts({});
			setFeedback({ kind: "ok", text: "已恢复全部默认设置。" });
		} catch (err) {
			setFeedback({ kind: "err", text: "重置失败：" + (err instanceof Error ? err.message : String(err)) });
		} finally {
			setSaving(false);
		}
	};

	const hasAnyDirty = FIELDS.some((group) => group.fields.some(isDirty));
	const hasAnyInvalid = FIELDS.some((group) => group.fields.some(hasInvalid));
	const crossError = crossFieldError();
	const saveDisabled = !writable || saving || !hasAnyDirty || hasAnyInvalid || crossError !== null;
	const feedbackClass = feedback === null ? "dcm-feedback" : `dcm-feedback ${feedback.kind === "err" ? "dcm-feedbackErr" : feedback.kind === "saved" ? "dcm-feedbackSaved" : "dcm-feedbackOk"}`;

	return (
		<div className="dcm-panel">
			<div className="dcm-header">
				<h2>Clear Mind · 清理思路</h2>
				<p>模型自主上下文压缩：mind_map 俯瞰上下文、clear_mind 压缩历史、主动提醒在上下文过长时自动提示。</p>
			</div>
			{FIELDS.map((group) => (
				<div key={group.section} className="dcm-section">
					<div className="dcm-section-title">{group.title}</div>
					{group.fields.map((field) => {
						const overridden = isOverridden(snapshot, field.key);
						if (field.type === "toggle") {
							const draft = draftOf(field);
							return (
								<div key={field.key} className="dcm-field">
									<div className="dcm-field-head">
										<label className="dcm-field-label">{field.label}</label>
										<div className="dcm-field-badges">
											{overridden ? <span className="dcm-badge">已覆盖</span> : null}
											{overridden ? (
												<button
													type="button"
													className="dcm-reset"
													disabled={!writable || saving}
													onClick={() => void handleResetField(field)}
												>
													重置
												</button>
											) : null}
										</div>
									</div>
									<div className="dcm-toggle">
										<button
											type="button"
											className="dcm-switch"
											data-on={draft === "true" ? "true" : "false"}
											disabled={!writable || saving}
											onClick={() => setDrafts((d) => ({ ...d, [field.key]: draft === "true" ? "false" : "true" }))}
										>
											<span className="dcm-switch-knob" />
										</button>
										<span className="dcm-hint">{field.hint}</span>
									</div>
								</div>
							);
						}
						return (
							<NumberField
								key={field.key}
								field={field}
								draft={draftOf(field)}
								overridden={overridden}
								writable={writable}
								saving={saving}
								onDraft={setDraft(field)}
								onUnset={() => void handleResetField(field)}
							/>
						);
					})}
				</div>
			))}
			<div className="dcm-actions">
				<button type="button" className="dcm-btn dcm-btnPrimary" disabled={saveDisabled} onClick={handleSave}>
					保存更改
				</button>
				<button type="button" className="dcm-btn" disabled={!writable || saving} onClick={handleResetAll}>
					恢复默认设置
				</button>
				<span className={feedbackClass}>{feedback?.text ?? ""}</span>
			</div>
		</div>
	);
}