"use client";

import type { LandlordField } from "@/lib/landlord-field";
import type { LandlordRule } from "@/lib/landlord-rule";
import { RuleBuilder, generateId, emptyCondition } from "./RuleBuilder";
import { countInvalidRuleConditions, getFirstInvalidRuleConditionId } from "@/lib/landlord-rule";

function buildEmptyRule(fields: LandlordField[], ruleKind: "reject" | "require"): LandlordRule & { _key: string } {
  return {
    _key: generateId(),
    id: generateId(),
    kind: ruleKind,
    conditions: [emptyCondition(fields)],
  };
}

function RuleList({
  rules,
  fields,
  ruleKind,
  title,
  description,
  badgeColor,
  onChange,
}: {
  rules: LandlordRule[];
  fields: LandlordField[];
  ruleKind: "reject" | "require";
  title: string;
  description: string;
  badgeColor: string;
  onChange: (rules: LandlordRule[]) => void;
}) {
  const listRules = rules.filter((r) => r.kind === ruleKind);

  function update(nextRows: LandlordRule[]) {
    const otherRules = rules.filter((r) => r.kind !== ruleKind);
    onChange([...otherRules, ...nextRows]);
  }

  function handleChange(index: number, updated: LandlordRule) {
    const next = [...listRules];
    next[index] = updated;
    update(next);
  }

  function handleDelete(index: number) {
    update(listRules.filter((_, i) => i !== index));
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const next = [...listRules];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    update(next);
  }

  function handleMoveDown(index: number) {
    if (index === listRules.length - 1) return;
    const next = [...listRules];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    update(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-[15px] font-semibold text-foreground/80 flex items-center gap-2">
          {title}
          {listRules.length > 0 && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor}`}>
              {listRules.length}
            </span>
          )}
        </h3>
        <p className="text-[13px] text-foreground/50 leading-relaxed mt-0.5">
          {description}
        </p>
        {ruleKind === "require" && listRules.length > 1 && (
          <p className="text-[11px] text-foreground/35 mt-1">
            Applicant must match at least one profile below.
          </p>
        )}
      </div>

      {listRules.length > 0 && (
        <div className="flex flex-col gap-1">
          {listRules.map((rule, i) => (
            <div key={rule.id}>
              {i > 0 && ruleKind === "require" && (
                <div className="flex items-center gap-3 my-2">
                  <div className="h-px flex-1 bg-teal-700/15" />
                  <span className="px-2 py-0.5 rounded-full bg-teal-50 text-[10px] font-bold uppercase tracking-wider text-teal-700/60 border border-teal-700/10">or</span>
                  <div className="h-px flex-1 bg-teal-700/15" />
                </div>
              )}
              <RuleBuilder
                rule={rule}
                fields={fields}
                isFirst={i === 0}
                isLast={i === listRules.length - 1}
                onChange={(updated) => handleChange(i, updated)}
                onDelete={() => handleDelete(i)}
                onMoveUp={() => handleMoveUp(i)}
                onMoveDown={() => handleMoveDown(i)}
                labelOverride={ruleKind === "require" ? "Accept applicant if:" : undefined}
              />
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          const nr = buildEmptyRule(fields, ruleKind);
          const plainRow = { id: nr.id, kind: nr.kind, conditions: nr.conditions };
          update([...listRules, plainRow]);
        }}
        className="self-start flex items-center gap-1.5 rounded-lg border border-dashed border-foreground/20 px-4 py-2 text-sm text-foreground/50 transition-colors hover:border-foreground/40 hover:text-foreground/70"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        {ruleKind === "reject" ? "Add rejection rule" : "Add acceptance profile"}
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
  const invalidCount = countInvalidRuleConditions(rules, fields);
  const firstErrorId = getFirstInvalidRuleConditionId(rules, fields);

  function jumpToFirstError() {
    if (!firstErrorId) return;
    const el = document.getElementById(`${firstErrorId}-error`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <section className="flex flex-col gap-10">
      {invalidCount > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-red-500 font-medium">
            {invalidCount} invalid rule{invalidCount === 1 ? "" : "s"} in this section.
          </span>
          <button
            type="button"
            onClick={jumpToFirstError}
            className="text-red-500/70 hover:text-red-600 underline decoration-red-500/30 underline-offset-2 transition-colors"
          >
            Jump to first error
          </button>
        </div>
      )}

      <RuleList
        rules={rules}
        fields={fields}
        onChange={onChange}
        ruleKind="require"
        title="Acceptance Profiles"
        description="Stack 'Accept' profiles to allow complex applicant combinations. If you define any profiles, applicants MUST match at least one of them."
        badgeColor="bg-teal-100 text-teal-800"
      />
      <div className="border-t border-foreground/10" />
      <RuleList
        rules={rules}
        fields={fields}
        onChange={onChange}
        ruleKind="reject"
        title="Automatic Rejections (Red Flags)"
        description="Catch-all rejections that trump everything else. If an applicant matches any of these, they are instantly rejected."
        badgeColor="bg-red-100 text-red-800"
      />
    </section>
  );
}
