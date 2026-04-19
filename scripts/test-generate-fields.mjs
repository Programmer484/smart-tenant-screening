#!/usr/bin/env node
/**
 * Smoke-test the /api/generate-fields endpoint with prompts that exercise
 * different parts of the workflow:
 *   1. Net-new field set (no existing context)
 *   2. Adding to an existing schema (avoid duplication, merge into existing question)
 *   3. Simple branching (one follow-up triggered by one prior answer)
 *   4. Sibling follow-ups (two follow-ups from the same parent answer)
 *   5. Multi-level chain (Q1 → Q2 → Q3)
 *
 * For each, we assert the response is valid JSON, structure is correct,
 * every fieldId in questions resolves, every parent reference resolves,
 * and triggers reference fields owned by the parent.
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";

const tests = [
  {
    name: "1) Net-new field set",
    body: {
      description:
        "Collect basic applicant info: full name, email, phone number, monthly income, and desired move-in date.",
      existingFields: [],
      existingQuestions: [],
      maxFieldsPerQuestion: 3,
    },
    expect: {
      hasNewFields: true,
      hasQuestions: true,
      hasFollowUps: false,
      minFields: 5,
    },
  },
  {
    name: "2) Add to existing schema (merge into existing question)",
    body: {
      description:
        "Also ask about smoking and recreational drug use as part of the house rules screening.",
      existingFields: [
        { id: "has_pets", label: "Has pets", value_kind: "boolean" },
        { id: "noise_tolerance", label: "Noise tolerance", value_kind: "text" },
      ],
      existingQuestions: [
        { id: "q_house_rules", text: "Do you have pets and how do you feel about quiet hours?", fieldIds: ["has_pets", "noise_tolerance"] },
      ],
      maxFieldsPerQuestion: 4,
    },
    expect: {
      hasNewFields: true,
      mergesIntoExistingQuestion: "q_house_rules",
    },
  },
  {
    name: "3) Simple branching",
    body: {
      description:
        "Ask if the applicant has any pets. If yes, also ask the number of pets and what kind. Otherwise skip those.",
      existingFields: [],
      existingQuestions: [],
      maxFieldsPerQuestion: 2,
    },
    expect: {
      hasNewFields: true,
      hasQuestions: true,
      hasFollowUps: true,
      minFollowUps: 1,
    },
  },
  {
    name: "4) Sibling follow-ups (multiple branches off same parent)",
    body: {
      description:
        "Ask if the applicant currently has a job. If yes, ask their employer name AND their monthly take-home pay AND how long they've been employed there. If no, skip all three of those.",
      existingFields: [],
      existingQuestions: [],
      maxFieldsPerQuestion: 1,
    },
    expect: {
      hasNewFields: true,
      hasQuestions: true,
      hasFollowUps: true,
      minFollowUps: 3, // employer, pay, tenure each child of is_employed
      sharedParent: true,
    },
  },
  {
    name: "5) Multi-level chain (Q1 → Q2 → Q3)",
    body: {
      description:
        "Ask if the applicant is moving with a partner. If yes, ask if the partner will also be on the lease. If they will be on the lease, ask the partner's full name and monthly income.",
      existingFields: [],
      existingQuestions: [],
      maxFieldsPerQuestion: 2,
    },
    expect: {
      hasNewFields: true,
      hasQuestions: true,
      hasFollowUps: true,
      minFollowUps: 2,
      multiLevel: true,
    },
  },
];

async function runOne(t) {
  const out = { name: t.name, ok: false, errors: [], warnings: [], summary: {} };
  try {
    const res = await fetch(`${BASE}/api/generate-fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(t.body),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      out.errors.push(`Response was not JSON. Status=${res.status}. Body: ${text.slice(0, 400)}`);
      return out;
    }
    out.summary.status = res.status;
    out.summary.raw = data;

    if (data.ok === false) {
      out.errors.push(`API returned ok=false: ${data.error}`);
      return out;
    }
    if (!res.ok) {
      out.errors.push(`HTTP ${res.status}`);
      return out;
    }

    const newFields = data.newFields || [];
    const questions = data.questions || [];
    const deletedQuestionIds = data.deletedQuestionIds || [];

    const followUps = questions.filter((q) => !!q.parentQuestionId && !!q.trigger);

    out.summary.counts = {
      newFields: newFields.length,
      questions: questions.length,
      deletedQuestionIds: deletedQuestionIds.length,
      followUps: followUps.length,
    };

    const knownIds = new Set([
      ...(t.body.existingFields || []).map((f) => f.id),
      ...newFields.map((f) => f.id),
    ]);
    const allQuestions = [...(t.body.existingQuestions || []), ...questions];
    const questionById = new Map(allQuestions.map((q) => [q.id, q]));

    for (const q of questions) {
      if (!Array.isArray(q.fieldIds) || q.fieldIds.length === 0) {
        out.errors.push(`Question "${q.id}" has no fieldIds`);
      }
      for (const fid of q.fieldIds || []) {
        if (!knownIds.has(fid)) out.errors.push(`Question "${q.id}" references unknown field "${fid}"`);
      }

      if (q.parentQuestionId) {
        const parent = questionById.get(q.parentQuestionId);
        if (!parent) {
          out.errors.push(`Question "${q.id}" references unknown parent "${q.parentQuestionId}"`);
        }
        if (!q.trigger) {
          out.errors.push(`Conditional question "${q.id}" missing trigger`);
        } else if (parent && !(parent.fieldIds || []).includes(q.trigger.fieldId)) {
          out.errors.push(`Question "${q.id}" trigger fieldId "${q.trigger.fieldId}" is not owned by parent "${parent.id}"`);
        }
      } else if (q.trigger) {
        out.errors.push(`Question "${q.id}" has trigger but no parentQuestionId`);
      }
    }

    // Field exclusivity across resulting question set
    const fieldOwner = new Map();
    for (const q of allQuestions) {
      for (const fid of q.fieldIds || []) {
        if (fieldOwner.has(fid) && fieldOwner.get(fid) !== q.id) {
          out.errors.push(`Field "${fid}" claimed by both "${fieldOwner.get(fid)}" and "${q.id}"`);
        }
        fieldOwner.set(fid, q.id);
      }
    }

    const ex = t.expect || {};
    if (ex.hasNewFields && newFields.length === 0) out.warnings.push(`Expected newFields but got 0`);
    if (ex.hasQuestions && questions.length === 0) out.warnings.push(`Expected questions but got 0`);
    if (ex.hasFollowUps && followUps.length === 0) out.warnings.push(`Expected follow-ups but got 0`);
    if (ex.minFields && newFields.length < ex.minFields) {
      out.warnings.push(`Expected >=${ex.minFields} fields, got ${newFields.length}`);
    }
    if (ex.minFollowUps && followUps.length < ex.minFollowUps) {
      out.warnings.push(`Expected >=${ex.minFollowUps} follow-ups, got ${followUps.length}`);
    }
    if (ex.mergesIntoExistingQuestion) {
      const merged = questions.find((q) => q.id === ex.mergesIntoExistingQuestion);
      if (!merged) {
        out.warnings.push(`Expected to merge into existing question "${ex.mergesIntoExistingQuestion}" but it was not in proposedQuestions`);
      }
    }
    if (ex.sharedParent && followUps.length >= 2) {
      const parents = new Set(followUps.map((f) => f.parentQuestionId));
      if (parents.size === followUps.length) {
        out.warnings.push(`Expected sibling follow-ups (shared parent) but each follow-up has a different parent`);
      }
    }
    if (ex.multiLevel) {
      // Deepest follow-up's parent is itself a follow-up
      const chain = followUps.find((f) => {
        const parent = questionById.get(f.parentQuestionId);
        return !!parent?.parentQuestionId;
      });
      if (!chain) {
        out.warnings.push(`Expected multi-level chain but no follow-up's parent is itself a follow-up`);
      } else {
        out.summary.chainDetected = true;
      }
    }

    out.ok = out.errors.length === 0;
    return out;
  } catch (e) {
    out.errors.push(`Exception: ${e.message}`);
    return out;
  }
}

(async () => {
  const results = [];
  for (const t of tests) {
    process.stdout.write(`Running ${t.name} ... `);
    const r = await runOne(t);
    process.stdout.write(r.ok ? "PASS" : "FAIL");
    if (r.warnings.length) process.stdout.write(` (warnings: ${r.warnings.length})`);
    process.stdout.write("\n");
    results.push(r);
  }

  console.log("\n────────── DETAIL ──────────");
  for (const r of results) {
    console.log(`\n## ${r.name}`);
    console.log(`Status: ${r.summary.status}, counts: ${JSON.stringify(r.summary.counts)}`);
    if (r.summary.chainDetected) console.log(`Chain detected`);
    if (r.errors.length) {
      console.log("ERRORS:");
      r.errors.forEach((e) => console.log("  - " + e));
    }
    if (r.warnings.length) {
      console.log("WARNINGS:");
      r.warnings.forEach((w) => console.log("  - " + w));
    }
    if (r.summary.raw) {
      console.log("Response:");
      console.log(JSON.stringify(r.summary.raw, null, 2));
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  const warns = results.filter((r) => r.warnings.length > 0).length;
  console.log(`\n────────── SUMMARY ──────────`);
  console.log(`PASS: ${results.length - failed} / ${results.length}, with warnings: ${warns}`);
  process.exit(failed > 0 ? 1 : 0);
})();
