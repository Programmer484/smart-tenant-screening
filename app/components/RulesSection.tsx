"use client";

import { useState, useEffect, useRef } from "react";
import type { LandlordField } from "@/lib/landlord-field";
import type { LandlordRule } from "@/lib/landlord-rule";
import { RuleBuilder, generateId, emptyCondition } from "./RuleBuilder";

function emptyRule(fields: LandlordField[]): LandlordRule & { _key: string } {
  return {
    _key: generateId(),
    id: generateId(),
    action: "reject",
    conditions: [emptyCondition(fields)],
  };
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
    // A quick fingerprint to detect external updates.
    // If we only care about ids, that might not be enough if a condition changes.
    // Let's just stringify for simplicity since it's small.
    return JSON.stringify(r);
  }

  // Only manage reject rules here
  const rejectRules = rules.filter(r => r.action === "reject");

  const [rows, setRows] = useState<(LandlordRule & { _key: string })[]>(() =>
    rejectRules.map((r) => ({ ...r, _key: generateId() })),
  );
  const sigRef = useRef(fingerprint(rejectRules));

  useEffect(() => {
    const nextReject = rules.filter(r => r.action === "reject");
    const sig = fingerprint(nextReject);
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      setRows(nextReject.map((r) => ({ ...r, _key: generateId() })));
    }
  }, [rules]);

  function update(nextRows: (LandlordRule & { _key: string })[]) {
    setRows(nextRows);
    const plainRows = nextRows.map(({ _key: _, ...r }) => r);
    sigRef.current = fingerprint(plainRows);

    // Merge back into full rules list
    const otherRules = rules.filter(r => r.action !== "reject");
    onChange([...otherRules, ...plainRows]);
  }

  function handleChange(index: number, updated: LandlordRule & { _key: string }) {
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
        Rejection Rules
      </h2>
      <p className="text-sm text-foreground/55">
        Each rule is a check on applicant answers. Applicants who match any rule are immediately rejected.
      </p>

      {rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {rows.map((rule, i) => (
            <RuleBuilder
              key={rule._key}
              rule={rule}
              fields={fields}
              isFirst={i === 0}
              isLast={i === rows.length - 1}
              onChange={(updated) => handleChange(i, { ...updated, _key: rule._key })}
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
        + Add rejection rule
      </button>
    </section>
  );
}
