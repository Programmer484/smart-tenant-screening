"use client";

import { useState, useEffect, useRef, useId } from "react";
import type { LandlordField } from "@/lib/landlord-field";
import {
  OPERATORS_BY_KIND,
  operatorLabel,
  type LandlordRule,
  defaultOperatorForKind,
  defaultValueForKind,
  validateRule,
} from "@/lib/landlord-rule";

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function emptyRule(fields: LandlordField[]): RuleWithKey {
  const firstField = fields[0];
  const kind = firstField?.value_kind ?? "text";
  return {
    _key: generateId(),
    id: generateId(),
    fieldId: firstField?.id ?? "",
    operator: defaultOperatorForKind(kind),
    value: defaultValueForKind(kind),
  };
}

type RuleWithKey = LandlordRule & { _key: string };

function RuleRow({
  rule,
  fields,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  rule: RuleWithKey;
  fields: LandlordField[];
  index: number;
  total: number;
  onChange: (updated: RuleWithKey) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const uid = useId();
  const field = fields.find((f) => f.id === rule.fieldId);
  const error = rule.fieldId ? validateRule(rule, fields) : null;
  const operators = field ? (OPERATORS_BY_KIND[field.value_kind] ?? ["=="]) : ["=="];

  function handleFieldChange(fieldId: string) {
    const f = fields.find((x) => x.id === fieldId);
    if (!f) return;
    onChange({
      ...rule,
      fieldId,
      operator: defaultOperatorForKind(f.value_kind),
      value: defaultValueForKind(f.value_kind),
    });
  }

  return (
    <div className="flex gap-3 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm">
      {/* Reorder controls */}
      <div className="flex flex-col items-center gap-0.5 pt-1 text-foreground/30">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          aria-label="Move up"
          className="rounded p-0.5 transition-colors hover:text-foreground/70 disabled:cursor-not-allowed disabled:opacity-20"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
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
          disabled={index === total - 1}
          aria-label="Move down"
          className="rounded p-0.5 transition-colors hover:text-foreground/70 disabled:cursor-not-allowed disabled:opacity-20"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Rule content */}
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* Field selector */}
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={`${uid}-field`} className="text-xs text-foreground/50">
              Field
            </label>
            {fields.length === 0 ? (
              <p className="text-xs text-foreground/40 italic">
                Add questions first
              </p>
            ) : (
              <select
                id={`${uid}-field`}
                value={rule.fieldId}
                onChange={(e) => handleFieldChange(e.target.value)}
                className="rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
              >
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label || f.id}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Operator selector */}
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-op`} className="text-xs text-foreground/50">
              Operator
            </label>
            <select
              id={`${uid}-op`}
              value={rule.operator}
              onChange={(e) => onChange({ ...rule, operator: e.target.value })}
              className="rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
            >
              {operators.map((op) => (
                <option key={op} value={op}>
                  {operatorLabel(op, field?.value_kind)}
                </option>
              ))}
            </select>
          </div>

          {/* Value input */}
          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-val`} className="text-xs text-foreground/50">
              Value
            </label>
            {field?.value_kind === "boolean" ? (
              <select
                id={`${uid}-val`}
                value={rule.value}
                onChange={(e) => onChange({ ...rule, value: e.target.value })}
                className="rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : field?.value_kind === "enum" ? (
              <select
                id={`${uid}-val`}
                value={rule.value}
                onChange={(e) => onChange({ ...rule, value: e.target.value })}
                className="rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
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
                id={`${uid}-val`}
                type={field?.value_kind === "number" ? "number" : field?.value_kind === "date" ? "date" : "text"}
                value={rule.value}
                onChange={(e) => onChange({ ...rule, value: e.target.value })}
                placeholder={field?.value_kind === "number" ? "0" : "value"}
                className="w-32 rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
              />
            )}
          </div>
        </div>

        {error ? (
          <p className="text-xs text-red-500">{error}</p>
        ) : null}
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete rule"
        className="mt-1 shrink-0 rounded-lg p-1.5 text-red-400/70 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M2 4h12M5 4V2.5A1.5 1.5 0 0 1 6.5 1h3A1.5 1.5 0 0 1 11 2.5V4m2 0-.75 9A1.5 1.5 0 0 1 10.75 14.5h-5.5A1.5 1.5 0 0 1 3.75 13L3 4"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M6.5 7v4M9.5 7v4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default function RulesSection({
  rules,
  fields,
  onChange,
}: {
  rules: LandlordRule[];
  fields: LandlordField[];
  onChange: (rules: LandlordRule[]) => void;
}) {
  function fingerprint(r: LandlordRule[]) {
    return r.map((x) => x.id).join("\0") + "\0" + r.length;
  }

  const [rows, setRows] = useState<RuleWithKey[]>(() =>
    rules.map((r) => ({ ...r, _key: generateId() })),
  );
  const sigRef = useRef(fingerprint(rules));

  useEffect(() => {
    const sig = fingerprint(rules);
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      setRows(rules.map((r) => ({ ...r, _key: generateId() })));
    }
  }, [rules]);

  function update(next: RuleWithKey[]) {
    setRows(next);
    const plain = next.map(({ _key: _, ...r }) => r);
    sigRef.current = fingerprint(plain);
    onChange(plain);
  }

  function handleChange(index: number, updated: RuleWithKey) {
    const next = [...rows];
    next[index] = updated;
    update(next);
  }

  function handleDelete(index: number) {
    update(rows.filter((_, i) => i !== index));
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const next = [...rows];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    update(next);
  }

  function handleMoveDown(index: number) {
    if (index === rows.length - 1) return;
    const next = [...rows];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    update(next);
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-medium tracking-tight text-foreground">
        Eligibility rules
      </h2>
      <p className="text-sm text-foreground/55">
        Each rule is a check on a field value. Applicants who fail any rule are rejected.
      </p>

      {rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {rows.map((rule, i) => (
            <RuleRow
              key={rule._key}
              rule={rule}
              fields={fields}
              index={i}
              total={rows.length}
              onChange={(updated) => handleChange(i, updated)}
              onDelete={() => handleDelete(i)}
              onMoveUp={() => handleMoveUp(i)}
              onMoveDown={() => handleMoveDown(i)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => update([...rows, emptyRule(fields)])}
        className="self-start rounded-lg border border-dashed border-foreground/20 px-4 py-2 text-sm text-foreground/50 transition-colors hover:border-foreground/40 hover:text-foreground/70"
      >
        + Add rule
      </button>
    </section>
  );
}
