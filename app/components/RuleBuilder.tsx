"use client";

import { useId } from "react";
import type { LandlordField } from "@/lib/landlord-field";
import {
  OPERATORS_BY_KIND,
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
  const uid = useId();
  const field = fields.find((f) => f.id === cond.fieldId);
  const error = cond.fieldId ? validateCondition(cond, fields) : null;
  const operators = field ? (OPERATORS_BY_KIND[field.value_kind] ?? ["=="]) : ["=="];

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
    <div className="flex flex-col gap-1 w-full">
      <div className="flex flex-wrap items-center gap-2 w-full">
        {/* Field selector */}
        {fields.length === 0 ? (
          <p className="text-xs text-foreground/40 italic flex-1 min-w-[120px]">
            Add questions first
          </p>
        ) : (
          <select
            value={cond.fieldId}
            onChange={(e) => handleFieldChange(e.target.value)}
            className="flex-1 min-w-[120px] rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
          >
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label || f.id}
              </option>
            ))}
          </select>
        )}

        {/* Operator selector */}
        <select
          value={cond.operator}
          onChange={(e) => onChange({ ...cond, operator: e.target.value })}
          className="w-32 rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
        >
          {operators.map((op) => (
            <option key={op} value={op}>
              {operatorLabel(op, field?.value_kind)}
            </option>
          ))}
        </select>

        {/* Value input */}
        {field?.value_kind === "boolean" ? (
          <select
            value={cond.value}
            onChange={(e) => onChange({ ...cond, value: e.target.value })}
            className="w-24 rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : field?.value_kind === "enum" ? (
          <select
            value={cond.value}
            onChange={(e) => onChange({ ...cond, value: e.target.value })}
            className="w-32 rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
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
            placeholder={field?.value_kind === "number" ? "0" : "value"}
            className="w-32 rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
          />
        )}

        {/* Delete condition button */}
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Remove condition"
            className="shrink-0 p-1.5 text-foreground/30 hover:text-red-500 transition-colors"
          >
             <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
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
}: {
  rule: LandlordRule;
  fields: LandlordField[];
  onChange: (updated: LandlordRule) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  return (
    <div className={`flex gap-3 rounded-xl border border-foreground/10 ${rule.action === 'reject' ? 'bg-background p-4 shadow-sm' : 'bg-transparent p-0'}`}>
      {/* Reorder controls for global rules */}
      {onMoveUp && onMoveDown && (
        <div className="flex flex-col items-center gap-0.5 pt-1 text-foreground/30">
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
      <div className="flex flex-1 flex-col gap-3">
        {rule.conditions.map((cond, idx) => (
          <div key={cond.id} className="flex flex-col gap-1">
            {idx > 0 && <span className="text-xs font-semibold text-teal-700/70 ml-2">AND</span>}
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

        {/* Add condition button */}
        <button
          type="button"
          onClick={() => {
             onChange({ ...rule, conditions: [...rule.conditions, emptyCondition(fields)] });
          }}
          className="self-start text-xs font-medium text-foreground/45 hover:text-teal-700 transition-colors"
        >
          + Add &quot;AND&quot; condition
        </button>
      </div>

      {/* Delete Rule */}
      <div className="pt-0.5">
        <button
          type="button"
          onClick={onDelete}
          aria-label={rule.action === 'reject' ? "Delete rule" : "Remove condition"}
          className={`shrink-0 rounded-lg p-1.5 transition-colors ${rule.action === 'reject' ? 'text-red-400/70 hover:bg-red-50 hover:text-red-500' : 'text-foreground/30 hover:text-red-500 hover:bg-red-50/50'}`}
        >
          {rule.action === 'reject' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M5 4V2.5A1.5 1.5 0 0 1 6.5 1h3A1.5 1.5 0 0 1 11 2.5V4m2 0-.75 9A1.5 1.5 0 0 1 10.75 14.5h-5.5A1.5 1.5 0 0 1 3.75 13L3 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6.5 7v4M9.5 7v4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
