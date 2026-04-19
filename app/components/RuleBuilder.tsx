"use client";

import type { LandlordField } from "@/lib/landlord-field";
import {
  OPERATORS_BY_KIND,
  VALUELESS_OPERATORS,
  operatorLabel,
  type LandlordRule,
  type RuleCondition,
  defaultOperatorForKind,
  defaultValueForKind,
  validateCondition,
} from "@/lib/landlord-rule";

export function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

export function emptyCondition(fields: LandlordField[]): RuleCondition {
  const firstField = fields[0];
  const kind = firstField?.value_kind ?? "text";
  return {
    id: generateId(),
    fieldId: firstField?.id ?? "",
    operator: defaultOperatorForKind(kind),
    value: defaultValueForKind(kind),
  };
}

/** Build a human-readable summary of a single condition */
function describeCond(cond: RuleCondition, fields: LandlordField[]): string {
  const field = fields.find((f) => f.id === cond.fieldId);
  const label = field?.label || cond.fieldId || "?";
  const op = operatorLabel(cond.operator, field?.value_kind);
  if (VALUELESS_OPERATORS.has(cond.operator)) return `${label} ${op}`;
  const val = field?.value_kind === "boolean"
    ? (cond.value === "true" ? "Yes" : "No")
    : cond.value || "…";
  return `${label} ${op} ${val}`;
}

/** Build a human-readable summary for a full rule (AND block) */
export function describeRule(rule: LandlordRule, fields: LandlordField[]): string {
  if (rule.conditions.length === 0) return "No conditions set";
  return rule.conditions.map((c) => describeCond(c, fields)).join(" and ");
}

function RuleConditionRow({
  cond,
  fields,
  onChange,
  onDelete,
  canDelete,
}: {
  cond: RuleCondition;
  fields: LandlordField[];
  onChange: (c: RuleCondition) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const field = fields.find((f) => f.id === cond.fieldId);
  const error = validateCondition(cond, fields);
  const operators = field ? (OPERATORS_BY_KIND[field.value_kind] ?? ["=="]) : ["=="];
  // "Broken" = the condition points at a field id that no longer exists. The
  // <select> below would otherwise silently swap to its first option on next
  // edit, which is exactly how stale rules quietly change behaviour.
  const isBroken = !!cond.fieldId && !field;

  function handleFieldChange(fieldId: string) {
    const f = fields.find((x) => x.id === fieldId);
    if (!f) return;
    onChange({
      ...cond,
      fieldId,
      operator: defaultOperatorForKind(f.value_kind),
      value: defaultValueForKind(f.value_kind),
    });
  }

  return (
    <div className="flex min-w-0 w-full flex-col gap-1">
      <div className="flex min-w-0 w-full flex-wrap items-start gap-2">
        {/* Field selector */}
        {fields.length === 0 ? (
          <p className="min-w-0 flex-1 basis-[120px] text-xs text-foreground/40 italic py-2">
            Add questions first
          </p>
        ) : (
          <div className="flex-1 basis-[120px] flex flex-col gap-1 min-w-0 max-w-full">
            <select
              value={cond.fieldId}
              onChange={(e) => handleFieldChange(e.target.value)}
              aria-invalid={!!isBroken}
              aria-describedby={isBroken ? `${cond.id}-error` : undefined}
              className={`w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 ${
                isBroken
                  ? "border-red-300 focus:border-red-400 focus:ring-red-200"
                  : "border-foreground/10 focus:border-foreground/25 focus:ring-foreground/15"
              }`}
            >
              {isBroken && (
                <option value={cond.fieldId}>
                  ⚠ Missing field: {cond.fieldId}
                </option>
              )}
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label || f.id}
                </option>
              ))}
            </select>
            {isBroken && (
              <p id={`${cond.id}-error`} className="text-[11px] font-medium text-red-500">
                Field <code className="font-mono">{cond.fieldId}</code> no longer exists.
              </p>
            )}
          </div>
        )}

        {/* Operator selector */}
        <div className="w-32 shrink-0 flex flex-col gap-1">
          <select
            value={cond.operator}
            onChange={(e) => onChange({ ...cond, operator: e.target.value })}
            className="w-full rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
          >
            {operators.map((op) => (
              <option key={op} value={op}>
                {operatorLabel(op, field?.value_kind)}
              </option>
            ))}
          </select>
        </div>

        {/* Value input — omitted for is_empty / is_not_empty (operator alone is the test) */}
        {VALUELESS_OPERATORS.has(cond.operator) ? null : (
          <div className="flex-1 min-w-[7rem] max-w-full flex flex-col gap-1">
            {field?.value_kind === "boolean" ? (
              <select
                value={cond.value}
                onChange={(e) => onChange({ ...cond, value: e.target.value })}
                aria-invalid={!!error && !isBroken}
                aria-describedby={error && !isBroken ? `${cond.id}-error` : undefined}
                className={`w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 ${
                  error && !isBroken
                    ? "border-red-300 focus:border-red-400 focus:ring-red-200"
                    : "border-foreground/10 focus:border-foreground/25 focus:ring-foreground/15"
                }`}
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : field?.value_kind === "enum" ? (
              <select
                value={cond.value}
                onChange={(e) => onChange({ ...cond, value: e.target.value })}
                aria-invalid={!!error && !isBroken}
                aria-describedby={error && !isBroken ? `${cond.id}-error` : undefined}
                className={`w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 ${
                  error && !isBroken
                    ? "border-red-300 focus:border-red-400 focus:ring-red-200"
                    : "border-foreground/10 focus:border-foreground/25 focus:ring-foreground/15"
                }`}
              >
                <option value="">Select…</option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field?.value_kind === "number" ? "number" : field?.value_kind === "date" ? "date" : "text"}
                value={cond.value}
                onChange={(e) => onChange({ ...cond, value: e.target.value })}
                placeholder={field?.value_kind === "number" ? "0" : "Enter a value"}
                aria-invalid={!!error && !isBroken}
                aria-describedby={error && !isBroken ? `${cond.id}-error` : undefined}
                className={`w-full rounded-lg border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:outline-none focus:ring-1 ${
                  error && !isBroken
                    ? "border-red-300 focus:border-red-400 focus:ring-red-200"
                    : "border-foreground/10 focus:border-foreground/25 focus:ring-foreground/15"
                }`}
              />
            )}
            {!isBroken && error && (
              <p id={`${cond.id}-error`} className="text-[11px] font-medium text-red-500">
                {error}
              </p>
            )}
          </div>
        )}

        {/* Delete condition button */}
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Remove requirement"
            className="shrink-0 p-1.5 mt-1.5 text-foreground/30 hover:text-red-500 transition-colors"
          >
             <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export function RuleBuilder({
  rule,
  fields,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  labelOverride,
}: {
  rule: LandlordRule;
  fields: LandlordField[];
  onChange: (updated: LandlordRule) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  labelOverride?: string;
}) {
  void describeRule;

  return (
    <div className="flex min-w-0 w-full gap-3 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm">
      {/* Reorder controls for global rules */}
      {onMoveUp && onMoveDown && (
        <div className="flex shrink-0 flex-col items-center gap-0.5 pt-1 text-foreground/30">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            className="rounded p-0.5 transition-colors hover:text-foreground/70 disabled:cursor-not-allowed disabled:opacity-20"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <svg width="10" height="14" viewBox="0 0 10 14" fill="none" className="opacity-40">
            <circle cx="3" cy="3" r="1" fill="currentColor" />
            <circle cx="7" cy="3" r="1" fill="currentColor" />
            <circle cx="3" cy="7" r="1" fill="currentColor" />
            <circle cx="7" cy="7" r="1" fill="currentColor" />
            <circle cx="3" cy="11" r="1" fill="currentColor" />
            <circle cx="7" cy="11" r="1" fill="currentColor" />
          </svg>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            className="rounded p-0.5 transition-colors hover:text-foreground/70 disabled:cursor-not-allowed disabled:opacity-20"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      )}

      {/* Conditions */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {(labelOverride || rule.kind === "reject") && (
          <span className="text-sm font-medium text-foreground/70">
            {labelOverride || "Reject applicant if:"}
          </span>
        )}

        <div className="flex flex-col gap-2">
          {rule.conditions.map((cond, idx) => (
            <div key={cond.id} className="flex flex-col gap-1">
              {idx > 0 && (
                <div className="flex items-center gap-2 ml-1 my-0.5">
                  <div className="h-px flex-1 bg-foreground/6" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/25">and</span>
                  <div className="h-px flex-1 bg-foreground/6" />
                </div>
              )}
              <RuleConditionRow
                cond={cond}
                fields={fields}
                onChange={(updatedCond) => {
                  const nextConds = [...rule.conditions];
                  nextConds[idx] = updatedCond;
                  onChange({ ...rule, conditions: nextConds });
                }}
                onDelete={() => {
                  onChange({ ...rule, conditions: rule.conditions.filter((_, i) => i !== idx) });
                }}
                canDelete={rule.conditions.length > 1}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            onChange({ ...rule, conditions: [...rule.conditions, emptyCondition(fields)] });
          }}
          className="self-start flex items-center gap-1 text-[11px] text-foreground/35 hover:text-teal-700 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          Add condition
        </button>
      </div>

      <div className="shrink-0 pt-0.5">
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete rule"
          className="shrink-0 rounded-lg p-1.5 text-red-400/60 transition-colors hover:bg-red-50 hover:text-red-500"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M5 4V2.5A1.5 1.5 0 0 1 6.5 1h3A1.5 1.5 0 0 1 11 2.5V4m2 0-.75 9A1.5 1.5 0 0 1 10.75 14.5h-5.5A1.5 1.5 0 0 1 3.75 13L3 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6.5 7v4M9.5 7v4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
