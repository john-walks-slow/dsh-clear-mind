window.__ModuleLoader__.load({
	id: "dsh-clear-mind",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/settings-panel.tsx
var React = __toESM(require("react"), 1);

// src/client/styles.ts
var CSS = `
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
var installed = false;
function installStyles() {
  if (installed) return;
  if (typeof document === "undefined") return;
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-clear-mind";
  tag.textContent = CSS;
  document.head.appendChild(tag);
  installed = true;
}

// src/client/settings-panel.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var FIELDS = [
  {
    section: "reminder",
    title: "\u4E3B\u52A8\u63D0\u9192 (Proactive Reminder)",
    fields: [
      { key: "reminderEnabled", label: "\u542F\u7528\u4E3B\u52A8\u63D0\u9192", hint: "\u5F53\u4E0A\u4E0B\u6587\u8FC7\u957F\u6216\u5355\u8F6E\u6B65\u6570\u8FC7\u591A\u65F6\uFF0C\u81EA\u52A8\u63D0\u9192\u6A21\u578B\u6E05\u7406\u601D\u8DEF\u3002", type: "toggle" },
      { key: "reminderThresholdRatio", label: "\u4E0A\u4E0B\u6587\u5360\u6BD4\u9608\u503C", hint: "\u4E0A\u4E0B\u6587\u5360\u6A21\u578B\u6700\u5927\u7A97\u53E3\u7684\u6BD4\u4F8B\uFF080.01 ~ 1.0\uFF09\uFF0C\u5982 0.90 = 90%\u3002", type: "number", min: 0.01, max: 1 },
      { key: "reminderThresholdTokens", label: "\u4E0A\u4E0B\u6587\u7EDD\u5BF9 Token \u9608\u503C", hint: "\u7EDD\u5BF9 Token \u6570\u9608\u503C\uFF080 \u8868\u793A\u4EC5\u6309\u6BD4\u4F8B\u8BA1\u7B97\uFF09\u3002", type: "number", min: 0 },
      { key: "reminderThresholdSteps", label: "\u5355\u8F6E\u6700\u5927 Step \u6B65\u6570", hint: "\u540C\u4E00\u8F6E\u5185\u8FDE\u7EED\u6267\u884C\u7684 Step \u6B65\u6570\u9608\u503C\uFF08\u2265 1\uFF09\u3002", type: "number", min: 1 },
      { key: "reminderStepInterval", label: "\u63D0\u9192\u51B7\u5374\u6B65\u6570", hint: "\u540C\u4E00\u8F6E\u5185\u4E24\u6B21\u63D0\u9192\u4E4B\u95F4\u7684\u6700\u5C0F\u6B65\u6570\u95F4\u9694\uFF08\u2265 1\uFF09\u3002", type: "number", min: 1 }
    ]
  },
  {
    section: "guards",
    title: "\u538B\u7F29\u4E0E\u68C0\u67E5\u70B9\u62A4\u680F (Compaction Guards)",
    fields: [
      { key: "minClearTokens", label: "\u6700\u5C0F\u6E05\u7406 Token \u6570", hint: "\u88AB\u6E05\u533A\u95F4 heuristic tokens \u4F4E\u4E8E\u6B64\u503C\u65F6\u4E0D\u5141\u8BB8\u6E05\u7406\uFF08\u9632\u6B62\u7410\u788E\u6E05\u7406\uFF09\u3002", type: "number", min: 1 },
      { key: "minNotesChars", label: "\u68C0\u67E5\u70B9\u7B14\u8BB0\u6700\u5C0F\u5B57\u6570", hint: "\u68C0\u67E5\u70B9\u7B14\u8BB0\u7684\u6700\u5C0F\u5B57\u7B26\u6570\uFF0C\u987B\u5C0F\u4E8E\u6700\u5927\u5B57\u6570\u3002", type: "number", min: 1 },
      { key: "maxNotesChars", label: "\u68C0\u67E5\u70B9\u7B14\u8BB0\u6700\u5927\u5B57\u6570", hint: "\u68C0\u67E5\u70B9\u7B14\u8BB0\u7684\u6700\u5927\u5B57\u7B26\u6570\uFF0C\u987B\u5927\u4E8E\u6700\u5C0F\u5B57\u6570\u3002", type: "number", min: 1 }
    ]
  },
  {
    section: "behavior",
    title: "\u8FD0\u884C\u65F6\u884C\u4E3A (Runtime Behaviors)",
    fields: [
      { key: "selfCollapse", label: "\u81EA\u52A8\u6298\u53E0 clear_mind \u8C03\u7528", hint: "\u5C06\u5DF2\u63D0\u4EA4\u7684 clear_mind \u8C03\u7528\u4E0E\u7ED3\u679C\u5728\u4E0B\u4E00\u6B65\u6298\u53E0\u4E3A\u4E00\u884C\u7B80\u62A5\u3002", type: "toggle" }
    ]
  }
];
var ALL_FIELDS = FIELDS.flatMap((group) => group.fields);
function isOverridden(snapshot, key) {
  const user = snapshot.user;
  return user !== void 0 && key in user;
}
function parseDraft(field, text) {
  if (field.type === "toggle") {
    return { value: text === "true", error: null };
  }
  const num = Number(text);
  if (text === "" || !Number.isFinite(num)) return { value: void 0, error: "\u8BF7\u8F93\u5165\u6709\u6548\u7684\u6570\u5B57" };
  if (field.min !== void 0 && num < field.min) return { value: void 0, error: `\u503C\u4E0D\u80FD\u5C0F\u4E8E ${field.min}` };
  if (field.max !== void 0 && num > field.max) return { value: void 0, error: `\u503C\u4E0D\u80FD\u5927\u4E8E ${field.max}` };
  return { value: num, error: null };
}
function formatValue(field, value) {
  if (field.type === "toggle") return value === true ? "true" : "false";
  return typeof value === "number" ? String(value) : "";
}
function NumberField(props) {
  const { field, draft, overridden, writable, saving, onDraft, onUnset } = props;
  const { error } = parseDraft(field, draft);
  const invalid = error !== null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dcm-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dcm-field-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dcm-field-label", children: field.label }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dcm-field-badges", children: [
        overridden ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dcm-badge", children: "\u5DF2\u8986\u76D6" }) : null,
        overridden ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dcm-reset", disabled: !writable || saving, onClick: onUnset, children: "\u91CD\u7F6E" }) : null
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        className: invalid ? "dcm-input dcm-inputInvalid" : "dcm-input",
        type: "text",
        inputMode: "numeric",
        value: draft,
        disabled: !writable || saving,
        onChange: (event) => onDraft(event.target.value)
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: invalid ? "dcm-invalid" : "dcm-hint", children: invalid ? error : field.hint })
  ] });
}
function SettingsPanel(props) {
  installStyles();
  const { scope } = props;
  const [snapshot, setSnapshot] = React.useState(scope.getSnapshot());
  const [drafts, setDrafts] = React.useState({});
  const [saving, setSaving] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null);
  React.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope]);
  if (snapshot.status === "loading") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dcm-loading", children: "\u6B63\u5728\u52A0\u8F7D\u8BBE\u7F6E\u2026" });
  if (snapshot.status === "unavailable") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dcm-loading", children: "\u8BBE\u7F6E\u4E0D\u53EF\u7528\uFF08\u5185\u5B58\u6A21\u5F0F\u6216\u547D\u540D\u7A7A\u95F4\u672A\u6CE8\u518C\uFF09\u3002" });
  const value = snapshot.value ?? {};
  const writable = snapshot.writable;
  const draftOf = (field) => drafts[field.key] ?? formatValue(field, value[field.key]);
  const isDirty = (field) => {
    const draft = drafts[field.key];
    if (draft === void 0) return false;
    return parseDraft(field, draft).value !== value[field.key];
  };
  const hasInvalid = (field) => {
    const draft = drafts[field.key];
    return draft !== void 0 && parseDraft(field, draft).error !== null;
  };
  const setDraft = (field) => (text) => setDrafts((d) => ({ ...d, [field.key]: text }));
  const crossFieldError = () => {
    const resolveField = (key) => {
      const field = ALL_FIELDS.find((candidate) => candidate.key === key);
      if (field === void 0) return void 0;
      const draft = drafts[key];
      if (draft !== void 0) {
        const parsed = parseDraft(field, draft);
        if (parsed.error !== null || parsed.value === void 0) return void 0;
        return typeof parsed.value === "number" ? parsed.value : void 0;
      }
      return typeof value[key] === "number" ? value[key] : void 0;
    };
    const min = resolveField("minNotesChars");
    const max = resolveField("maxNotesChars");
    if (min !== void 0 && max !== void 0 && min >= max) {
      return "\u68C0\u67E5\u70B9\u7B14\u8BB0\u6700\u5C0F\u5B57\u6570\u5FC5\u987B\u5C0F\u4E8E\u6700\u5927\u5B57\u6570\uFF08minNotesChars < maxNotesChars\uFF09\u3002";
    }
    return null;
  };
  const handleSave = async () => {
    const crossError2 = crossFieldError();
    if (crossError2 !== null) {
      setFeedback({ kind: "err", text: crossError2 });
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
          if (error !== null || parsed === void 0) continue;
          await scope.set(field.key, parsed);
          savedCount++;
        }
      }
      setDrafts({});
      setFeedback({ kind: "saved", text: savedCount > 0 ? `\u5DF2\u4FDD\u5B58 ${savedCount} \u9879\u66F4\u6539\u3002` : "\u65E0\u9700\u8981\u4FDD\u5B58\u7684\u66F4\u6539\u3002" });
    } catch (err) {
      setFeedback({ kind: "err", text: "\u4FDD\u5B58\u5931\u8D25\uFF1A" + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setSaving(false);
    }
  };
  const handleResetField = async (field) => {
    setSaving(true);
    setFeedback(null);
    try {
      await scope.unset(field.key);
      setDrafts((d) => {
        const next = { ...d };
        delete next[field.key];
        return next;
      });
      setFeedback({ kind: "ok", text: `\u5DF2\u5C06\u300C${field.label}\u300D\u6062\u590D\u4E3A\u9ED8\u8BA4\u503C\u3002` });
    } catch (err) {
      setFeedback({ kind: "err", text: "\u91CD\u7F6E\u5931\u8D25\uFF1A" + (err instanceof Error ? err.message : String(err)) });
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
      setFeedback({ kind: "ok", text: "\u5DF2\u6062\u590D\u5168\u90E8\u9ED8\u8BA4\u8BBE\u7F6E\u3002" });
    } catch (err) {
      setFeedback({ kind: "err", text: "\u91CD\u7F6E\u5931\u8D25\uFF1A" + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setSaving(false);
    }
  };
  const hasAnyDirty = FIELDS.some((group) => group.fields.some(isDirty));
  const hasAnyInvalid = FIELDS.some((group) => group.fields.some(hasInvalid));
  const crossError = crossFieldError();
  const saveDisabled = !writable || saving || !hasAnyDirty || hasAnyInvalid || crossError !== null;
  const feedbackClass = feedback === null ? "dcm-feedback" : `dcm-feedback ${feedback.kind === "err" ? "dcm-feedbackErr" : feedback.kind === "saved" ? "dcm-feedbackSaved" : "dcm-feedbackOk"}`;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dcm-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dcm-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "Clear Mind \xB7 \u6E05\u7406\u601D\u8DEF" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u6A21\u578B\u81EA\u4E3B\u4E0A\u4E0B\u6587\u538B\u7F29\uFF1Amind_map \u4FEF\u77B0\u4E0A\u4E0B\u6587\u3001clear_mind \u538B\u7F29\u5386\u53F2\u3001\u4E3B\u52A8\u63D0\u9192\u5728\u4E0A\u4E0B\u6587\u8FC7\u957F\u65F6\u81EA\u52A8\u63D0\u793A\u3002" })
    ] }),
    FIELDS.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dcm-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dcm-section-title", children: group.title }),
      group.fields.map((field) => {
        const overridden = isOverridden(snapshot, field.key);
        if (field.type === "toggle") {
          const draft = draftOf(field);
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dcm-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dcm-field-head", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "dcm-field-label", children: field.label }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dcm-field-badges", children: [
                overridden ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dcm-badge", children: "\u5DF2\u8986\u76D6" }) : null,
                overridden ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "button",
                  {
                    type: "button",
                    className: "dcm-reset",
                    disabled: !writable || saving,
                    onClick: () => void handleResetField(field),
                    children: "\u91CD\u7F6E"
                  }
                ) : null
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dcm-toggle", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  type: "button",
                  className: "dcm-switch",
                  "data-on": draft === "true" ? "true" : "false",
                  disabled: !writable || saving,
                  onClick: () => setDrafts((d) => ({ ...d, [field.key]: draft === "true" ? "false" : "true" })),
                  children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dcm-switch-knob" })
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dcm-hint", children: field.hint })
            ] })
          ] }, field.key);
        }
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          NumberField,
          {
            field,
            draft: draftOf(field),
            overridden,
            writable,
            saving,
            onDraft: setDraft(field),
            onUnset: () => void handleResetField(field)
          },
          field.key
        );
      })
    ] }, group.section)),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dcm-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dcm-btn dcm-btnPrimary", disabled: saveDisabled, onClick: handleSave, children: "\u4FDD\u5B58\u66F4\u6539" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dcm-btn", disabled: !writable || saving, onClick: handleResetAll, children: "\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: feedbackClass, children: feedback?.text ?? "" })
    ] })
  ] });
}

// src/client/index.ts
var inject = ["slots", "settingsScope"];
function apply(ctx) {
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: "clear-mind",
        order: 125,
        label: () => "Clear Mind",
        inject: () => ({
          scope: ctx.settingsScope.bind({ namespace: "clear-mind" })
        })
      },
      SettingsPanel
    )
  );
}

		return module.exports;
	}
});