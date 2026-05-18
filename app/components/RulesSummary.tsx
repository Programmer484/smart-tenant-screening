"use client";

import type { LandlordField } from "@/lib/landlord-field";
import type { Question, Branch } from "@/lib/question";
import type { PropertyVariable } from "@/lib/property";
import { describeCondition, resolveVarTokens } from "@/lib/condition-utils";

type BranchRule = {
  questionText: string;
  condition: string;
  outcome: "reject";
  customMessage?: string;
};

function extractBranchRules(questions: Question[], fields: LandlordField[], variables: PropertyVariable[]): BranchRule[] {
  const result: BranchRule[] = [];

  function walk(qs: Question[]) {
    for (const q of [...qs].sort((a, b) => a.sort_order - b.sort_order)) {
      for (const branch of q.branches) {
        if (branch.outcome === "reject") {
          result.push({
            questionText: resolveVarTokens(q.text || "(untitled question)", variables),
            condition: describeCondition(branch.condition, fields, variables),
            outcome: branch.outcome,
            customMessage: (branch as Branch & { customMessage?: string }).customMessage,
          });
        }
        if (branch.outcome === "followups") {
          walk(branch.subQuestions);
        }
      }
    }
  }

  walk(questions);
  return result;
}

export default function RulesSummary({
  questions,
  fields,
  variables = [],
}: {
  questions: Question[];
  fields: LandlordField[];
  variables?: PropertyVariable[];
}) {
  const branchRules = extractBranchRules(questions, fields, variables);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground/80">Rejection outcomes</h3>
        <p className="mt-0.5 text-xs text-foreground/45">
          All rejection criteria come from your question branches. Add or edit them in the Questions tab.
        </p>
      </div>

      {branchRules.length === 0 ? (
        <p className="text-sm text-foreground/35 italic">
          No rejection outcomes yet — add reject branches to your questions to define screening criteria.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {branchRules.map((r, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-red-100 bg-red-50/40 px-3 py-2.5 text-sm"
            >
              <span className="mt-0.5 shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                Reject
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs text-foreground/40 truncate">
                  {r.questionText}
                </span>
                <span className="font-medium text-foreground/75">{r.condition}</span>
                {r.customMessage && (
                  <span className="text-xs text-foreground/40 italic">
                    &ldquo;{r.customMessage}&rdquo;
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
