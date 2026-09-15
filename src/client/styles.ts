/**
 * CSS-in-JS: styles for the Clear Mind settings panel.
 * Injected as a single <style> tag once on first mount.
 */
const CSS = `
.dcm-panel { display: flex; flex-direction: column; gap: 16px; padding: 8px 0; }
.dcm-header { display: flex; flex-direction: column; gap: 4px; }
.dcm-header h2 { margin: 0; font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary, #1a1a1a); }
.dcm-header p { margin: 0; font-size: 13px; color: var(--dsw-alias-label-tertiary, #999); }
.dcm-section { display: flex; flex-direction: column; gap: 0; border-radius: 10px; overflow: hidden; border: 0.5px solid var(--dsw-alias-border-l2, #333); }
.dcm-section-title { padding: 12px 16px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary, #666); background: var(--dsw-alias-bg-module-platform, transparent); }
.dcm-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; border-top: 0.5px solid var(--dsw-alias-border-l2, #333); }
.dcm-section-title + .dcm-field { border-top: none; }
.dcm-field-head { display: flex; align-items: center; gap: 8px; }
.dcm-field-label { min-width: 0; flex: 1; font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary, #1a1a1a); }
.dcm-field-badges { display: inline-flex; align-items: center; gap: 8px; }
.dcm-badge { white-space: nowrap; background: var(--dsw-alias-bg-module-platform, #eee); color: var(--dsw-alias-label-secondary, #666); border-radius: 999px; padding: 1px 8px; font-size: 11px; font-weight: 500; line-height: 17px; }
.dcm-reset { font: inherit; color: var(--dsw-alias-label-secondary, #666); cursor: pointer; background: none; border: none; padding: 0; font-size: 12px; line-height: 1.5; }
.dcm-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary, #1a1a1a); }
.dcm-reset:disabled { cursor: default; }
.dcm-input { border: 0.5px solid var(--dsw-alias-border-l4, #555); background: var(--dsw-alias-bg-layer-3, transparent); height: 34px; font: inherit; color: var(--dsw-alias-label-primary, #1a1a1a); border-radius: 8px; padding: 0 12px; font-size: 13px; line-height: 1.5; }
.dcm-input:focus-visible { border-color: var(--dsw-alias-brand-primary, #007aff); outline: none; }
.dcm-input:disabled { color: var(--dsw-alias-label-tertiary, #999); cursor: default; }
.dcm-inputInvalid { border-color: var(--dsw-alias-label-error, #ff3b30); }
.dcm-hint { color: var(--dsw-alias-label-tertiary, #999); margin: 0; font-size: 12px; line-height: 1.5; }
.dcm-invalid { color: var(--dsw-alias-label-error, #ff3b30); margin: 0; font-size: 12px; line-height: 1.5; }
.dcm-toggle { display: flex; align-items: center; gap: 8px; }
.dcm-switch { position: relative; width: 40px; height: 22px; border-radius: 999px; background: var(--dsw-alias-bg-layer-4, #ccc); border: 0.5px solid var(--dsw-alias-border-l4, #555); cursor: pointer; transition: background 0.2s; }
.dcm-switch[data-on="true"] { background: var(--dsw-alias-brand-primary, #007aff); }
.dcm-switch-knob { position: absolute; top: 1px; left: 1px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
.dcm-switch[data-on="true"] .dcm-switch-knob { transform: translateX(18px); }
.dcm-switch:disabled { opacity: 0.5; cursor: default; }
.dcm-actions { display: flex; align-items: center; gap: 12px; padding-top: 4px; }
.dcm-btn { font: inherit; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer; border: 0.5px solid var(--dsw-alias-border-l4, #555); background: var(--dsw-alias-bg-layer-3, transparent); color: var(--dsw-alias-label-primary, #1a1a1a); }
.dcm-btn:disabled { opacity: 0.5; cursor: default; }
.dcm-btnPrimary { background: var(--dsw-alias-brand-primary, #007aff); color: #fff; border-color: transparent; }
.dcm-feedback { font-size: 12px; line-height: 1.5; min-height: 18px; }
.dcm-feedbackOk { color: var(--dsw-alias-label-secondary, #666); }
.dcm-feedbackErr { color: var(--dsw-alias-label-error, #ff3b30); }
.dcm-feedbackSaved { color: var(--dsw-alias-label-secondary, #666); }
.dcm-loading { padding: 24px; text-align: center; color: var(--dsw-alias-label-tertiary, #999); font-size: 13px; }
`;

let installed = false;
export function installStyles(): void {
	if (installed) return;
	if (typeof document === "undefined") return;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-clear-mind";
	tag.textContent = CSS;
	document.head.appendChild(tag);
	installed = true;
}
