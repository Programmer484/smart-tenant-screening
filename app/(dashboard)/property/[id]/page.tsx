"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { PropertyRecord, PropertyLinks, AiInstructions } from "@/lib/property";
import { DEFAULT_AI_INSTRUCTIONS, DEFAULT_LINKS, resolveAiInstructions } from "@/lib/property";
import type { LandlordField } from "@/lib/landlord-field";
import {
  isFieldVisibilityRule,
  normalizeRulesList,
  type LandlordRule,
} from "@/lib/landlord-rule";
import type { Question } from "@/lib/question";
import RulesSection from "@/app/components/RulesSection";
import FlowEditor from "@/app/components/FlowEditor";
import { PropertyEditorSkeleton } from "@/app/components/Skeleton";
import { ConfirmDialog } from "@/app/components/ConfirmDialog";
import { RuleProposalModal, type Proposal } from "@/app/components/RuleProposalModal";
import LandlordFieldsSection from "@/app/components/LandlordFieldsSection";

const TABS = ["Fields", "Questions", "Rules", "Links", "AI Behavior"] as const;
type Tab = (typeof TABS)[number];

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function migrateRules(rawRules: unknown[]): LandlordRule[] {
  return normalizeRulesList(rawRules);
}

function ruleReferencesField(r: LandlordRule, fieldId: string): boolean {
  if (r.targetFieldId === fieldId) return true;
  return r.conditions.some((c) => c.fieldId === fieldId);
}

function summarizeRule(r: LandlordRule): string {
  const conds = r.conditions.map((c) => `${c.fieldId} ${c.operator} ${c.value}`).join("; ");
  if (isFieldVisibilityRule(r)) {
    const tgt = r.targetFieldId ? ` (field: ${r.targetFieldId})` : "";
    return `Show field${tgt} when: ${conds}`;
  }
  if (r.kind === "reject") return `Reject: ${conds}`;
  return `Require: ${conds}`;
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function PropertySetupPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<LandlordField[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [rules, setRules] = useState<LandlordRule[]>([]);
  const [links, setLinks] = useState<PropertyLinks>(DEFAULT_LINKS);
  const [aiInstructions, setAiInstructions] = useState<AiInstructions>(DEFAULT_AI_INSTRUCTIONS);

  const [activeTab, setActiveTab] = useState<Tab>("Questions");
  const [loadingPhase, setLoadingPhase] = useState<null | "questions" | "rules">(null);
  const [saving, setSaving] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedRef] = useState(() => ({ current: "" }));
  const [showSaved, setShowSaved] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<(_?: Partial<PropertyRecord>) => Promise<void>>(async () => {});
  const serializedStateRef = useRef("");
  const hasLoadedRef = useRef(false);
  const [questionsPrompt, setQuestionsPrompt] = useState("");
  const [rulesPrompt, setRulesPrompt] = useState("");
  const [ruleProposal, setRuleProposal] = useState<Proposal | null>(null);
  const [fieldDeleteIndex, setFieldDeleteIndex] = useState<number | null>(null);

  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);

  // ── Load property ──
  useEffect(() => {
    async function load() {
      const propRes = await supabase
        .from("properties")
        .select("*")
        .eq("id", id)
        .single();

      if (propRes.error || !propRes.data) {
        setError("Property not found.");
        setPageLoading(false);
        return;
      }

      const p = propRes.data as PropertyRecord;
      setTitle(p.title);
      setDescription(p.description);
      setFields((p.fields as LandlordField[]) ?? []);
      setQuestions(((p.questions as Question[]) ?? []).map((q) => ({ ...q, branches: q.branches ?? [] })));
      const migratedRules = migrateRules((p.rules as any[]) ?? []);
      setRules(migratedRules);
      setLinks({ ...DEFAULT_LINKS, ...(p.links as Partial<PropertyLinks>) });
      setAiInstructions(resolveAiInstructions(p.ai_instructions));

      lastSavedRef.current = JSON.stringify({
        title: p.title, description: p.description,
        fields: (p.fields as LandlordField[]) ?? [],
        questions: ((p.questions as Question[]) ?? []).map((q) => ({ ...q, branches: q.branches ?? [] })),
        rules: migratedRules, links: { ...DEFAULT_LINKS, ...(p.links as Partial<PropertyLinks>) },
        aiInstructions: resolveAiInstructions(p.ai_instructions),
      });
      hasLoadedRef.current = true;
      setPageLoading(false);
    }
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dirty tracking ──
  useEffect(() => {
    if (pageLoading) return;
    const current = JSON.stringify({ title, description, fields, questions, rules, links, aiInstructions });
    setDirty(current !== lastSavedRef.current);
  }, [title, description, fields, questions, rules, links, aiInstructions, pageLoading, lastSavedRef]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) { e.preventDefault(); }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ── Save ──
  const save = useCallback(
    async (overrides?: Partial<PropertyRecord>) => {
      setSaving(true);
      const { error } = await supabase
        .from("properties")
        .update({
          title: title.trim() || "New Property",
          description: description.trim(),
          fields,
          questions,
          rules,
          links,
          ai_instructions: aiInstructions,
          updated_at: new Date().toISOString(),
          ...overrides,
        })
        .eq("id", id);
      setSaving(false);
      if (error) { console.error("[save]", error); toast.error("Failed to save"); }
      else {
        lastSavedRef.current = JSON.stringify({ title, description, fields, questions, rules, links, aiInstructions });
        setDirty(false);
        if (savedIndicatorTimerRef.current) clearTimeout(savedIndicatorTimerRef.current);
        setShowSaved(true);
        savedIndicatorTimerRef.current = setTimeout(() => {
          setShowSaved(false);
          savedIndicatorTimerRef.current = null;
        }, 2000);
      }
    },
    [id, title, description, fields, questions, rules, links, aiInstructions, supabase], // eslint-disable-line react-hooks/exhaustive-deps
  );

  saveRef.current = save;

  function cancelAutosaveTimer() {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }

  const flushSave = useCallback(async () => {
    cancelAutosaveTimer();
    if (!hasLoadedRef.current) return;
    if (serializedStateRef.current === lastSavedRef.current) return;
    await save();
  }, [save]);

  serializedStateRef.current = JSON.stringify({
    title, description, fields, questions, rules, links, aiInstructions,
  });

  // Debounced autosave (2s after last edit while dirty)
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    if (pageLoading || loadingPhase !== null) return;
    if (!dirty) return;
    if (saving) return;
    cancelAutosaveTimer();
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void save();
    }, 2000);
    return () => {
      cancelAutosaveTimer();
    };
  }, [
    title,
    description,
    fields,
    questions,
    rules,
    links,
    aiInstructions,
    pageLoading,
    loadingPhase,
    dirty,
    saving,
    save,
  ]);

  // Flush pending changes on unmount (e.g. client navigation away)
  // Uses a direct supabase call instead of save() to avoid state updates on an unmounted component.
  useEffect(() => {
    return () => {
      if (savedIndicatorTimerRef.current) {
        clearTimeout(savedIndicatorTimerRef.current);
        savedIndicatorTimerRef.current = null;
      }
      if (!hasLoadedRef.current) return;
      if (serializedStateRef.current === lastSavedRef.current) return;
      try {
        const state = JSON.parse(serializedStateRef.current);
        void supabase
          .from("properties")
          .update({
            title: (state.title ?? "").trim() || "New Property",
            description: (state.description ?? "").trim(),
            fields: state.fields,
            questions: state.questions,
            rules: state.rules,
            links: state.links,
            ai_instructions: state.aiInstructions,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .then(({ error }) => { if (error) console.error("[unmount-save]", error); });
      } catch { /* serialization error — skip */ }
    };
  }, [id, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate questions with prompt ──
  async function handleGenerateQuestions(prompt: string) {
    if (!prompt.trim()) {
      toast.error("Enter a prompt describing what questions to generate");
      return;
    }
    try {
      setLoadingPhase("questions");
      const existingVisRules = rules.filter(isFieldVisibilityRule).map((r) => ({
        targetFieldId: r.targetFieldId!,
        conditions: r.conditions.map((c) => ({ fieldId: c.fieldId, operator: c.operator, value: c.value })),
      }));
      const res = await fetch("/api/generate-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: prompt,
          existingFields: fields.map((f) => ({ id: f.id, label: f.label, value_kind: f.value_kind })),
          existingQuestions: questions.map((q) => ({ id: q.id, text: q.text, fieldIds: q.fieldIds })),
          existingVisibilityRules: existingVisRules,
        }),
      });
      const data = await res.json();

      if (data.ok === false) {
        if (data.raw) {
          console.group("[generate-fields] AI returned bad output");
          console.log("Error:", data.error);
          console.log("Raw AI response:\n", data.raw);
          console.groupEnd();
        }
        if (data.violations?.length) {
          const names = data.violations.map((v: { text: string }) => `"${v.text}"`).join(", ");
          toast.error(`${data.error}: ${names}`);
        } else {
          toast.error(data.error ?? "Generation failed");
        }
        return;
      }

      const proposedFields: LandlordField[] = data.newFields ?? [];
      const proposedQuestions: Question[] = data.questions ?? [];
      const deletedQuestionIds: string[] = data.deletedQuestionIds ?? [];
      const visibilityRules: LandlordRule[] = data.visibilityRules ?? [];

      if (proposedFields.length === 0 && proposedQuestions.length === 0 && deletedQuestionIds.length === 0 && visibilityRules.length === 0) {
        toast.info("No new items to add — AI found everything is covered.");
        return;
      }

      setRuleProposal({
        newRules: [],
        modifiedRules: [],
        deletedRuleIds: [],
        newFields: proposedFields,
        proposedQuestions,
        deletedQuestionIds,
        visibilityRules,
      });
    } catch (err) {
      console.error("[generateQuestions]", err);
      toast.error("Generation failed — please try again");
    } finally {
      setLoadingPhase(null);
    }
  }

  // ── Generate rules with prompt ──
  async function handleGenerateRules(prompt: string) {
    if (!prompt.trim()) {
      toast.error("Enter a prompt describing what rules to generate");
      return;
    }
    if (fields.length === 0) {
      toast.error("Add fields first so rules can reference them");
      return;
    }
    try {
      setLoadingPhase("rules");
      const res = await fetch("/api/generate-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: prompt,
          fields,
          existingRules: rules,
        }),
      });
      const data = (await res.json()) as {
        newRules?: LandlordRule[];
        modifiedRules?: LandlordRule[];
        deletedRuleIds?: string[];
        newFields?: LandlordField[];
      };

      const newRules = migrateRules(data.newRules ?? []);
      const modifiedRules = migrateRules(data.modifiedRules ?? []);
      const deletedRuleIds = data.deletedRuleIds ?? [];
      const newFields = data.newFields ?? [];

      if (newFields.length > 0) {
        toast.info("Analyzing missing fields...");
        const newFieldsDesc = newFields.map(f => `${f.label || f.id} (type: ${f.value_kind})`).join(", ");
        const existingVisRules = rules.filter(isFieldVisibilityRule).map((r) => ({
          targetFieldId: r.targetFieldId!,
          conditions: r.conditions.map((c) => ({ fieldId: c.fieldId, operator: c.operator, value: c.value })),
        }));
        const res2 = await fetch("/api/generate-fields", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
             description: `We are building new screening rules that require these NEW fields (not in the schema yet): ${newFieldsDesc}. We need interview questions to collect them.\n\nIMPORTANT: Look at EXISTING QUESTIONS in the system context. If any existing question is on the same topic as these fields (e.g. house rules, smoking, pets, drugs, income — or one combined "policies" style question), UPDATE that question: keep its id, add the new field id(s) to fieldIds, and rewrite the question text so it naturally asks for everything in one place. Only add a brand-new question if no existing question is a good fit. Prefer merging related checks into one question when it stays readable.`,
             existingFields: fields.map((f) => ({ id: f.id, label: f.label, value_kind: f.value_kind })),
             existingQuestions: questions.map((q) => ({ id: q.id, text: q.text, fieldIds: q.fieldIds })),
             existingVisibilityRules: existingVisRules,
          })
        });
        const data2 = await res2.json();

        if (data2.ok === false) {
          if (data2.raw) {
            console.group("[generate-fields] AI returned bad output (from rule flow)");
            console.log("Error:", data2.error);
            console.log("Raw AI response:\n", data2.raw);
            console.groupEnd();
          }
          toast.error(data2.error ?? "Failed to generate questions for new fields");
        }

        setRuleProposal({
           newRules,
           modifiedRules,
           deletedRuleIds,
           newFields,
           proposedQuestions: data2.ok !== false ? (data2.questions || []) : [],
           deletedQuestionIds: data2.ok !== false ? (data2.deletedQuestionIds || []) : [],
           visibilityRules: data2.ok !== false ? (data2.visibilityRules || []) : [],
        });
        return;
      }

      setRuleProposal({
        newRules,
        modifiedRules,
        deletedRuleIds,
        newFields: [],
        proposedQuestions: [],
        deletedQuestionIds: [],
        visibilityRules: [],
      });

    } catch (err) {
      console.error("[generateRules]", err);
      toast.error("Rule generation failed — please try again");
    } finally {
      setLoadingPhase(null);
    }
  }

  function applyProposal() {
    if (!ruleProposal) return;

    // 1. Add new fields
    if (ruleProposal.newFields.length > 0) {
      setFields((prev) => [...prev, ...ruleProposal.newFields.map(f => ({ ...f, _isNew: true, _clientId: generateId() }) as unknown as LandlordField)]);
    }

    // 2. Delete questions -> replace/append questions -> renumber
    if (ruleProposal.proposedQuestions.length > 0 || ruleProposal.deletedQuestionIds.length > 0) {
      setQuestions((prev) => {
        let next = [...prev];

        // Delete
        if (ruleProposal.deletedQuestionIds.length > 0) {
          const deleteSet = new Set(ruleProposal.deletedQuestionIds);
          next = next.filter((q) => !deleteSet.has(q.id));
        }

        // Upsert: replace text + fieldIds for existing, collect truly new
        const newQs: Question[] = [];
        for (const pq of ruleProposal.proposedQuestions) {
          const idx = next.findIndex((q) => q.id === pq.id);
          if (idx >= 0) {
            next[idx] = { ...next[idx], text: pq.text, fieldIds: pq.fieldIds, extract_hint: pq.extract_hint };
          } else {
            newQs.push({ ...pq, branches: pq.branches ?? [] });
          }
        }

        if (newQs.length > 0) {
          next = [...next, ...newQs];
        }

        // Renumber sort_order
        return next.map((q, i) => ({ ...q, sort_order: i }));
      });
    }

    // 3. Delete / modify / add rules + visibility rules (dedup by targetFieldId)
    setRules((prev) => {
      let next = [...prev];
      if (ruleProposal.deletedRuleIds.length > 0) {
        next = next.filter((r) => !ruleProposal.deletedRuleIds.includes(r.id));
      }
      for (const mod of ruleProposal.modifiedRules) {
        const idx = next.findIndex((r) => r.id === mod.id);
        if (idx >= 0) next[idx] = mod;
      }
      if (ruleProposal.newRules.length > 0) {
        next = [...next, ...ruleProposal.newRules];
      }
      if (ruleProposal.visibilityRules.length > 0) {
        for (const vr of ruleProposal.visibilityRules) {
          const existingIdx = next.findIndex(
            (r) => isFieldVisibilityRule(r) && r.targetFieldId === vr.targetFieldId,
          );
          if (existingIdx >= 0) {
            next[existingIdx] = vr;
          } else {
            next.push(vr);
          }
        }
      }
      return next;
    });

    const parts: string[] = [];
    const rc = ruleProposal.newRules.length + ruleProposal.modifiedRules.length + ruleProposal.deletedRuleIds.length;
    const fc = ruleProposal.newFields.length;
    const qc = ruleProposal.proposedQuestions.length + ruleProposal.deletedQuestionIds.length;
    const vc = ruleProposal.visibilityRules.length;
    if (rc > 0) parts.push(`${rc} rule(s)`);
    if (fc > 0) parts.push(`${fc} field(s)`);
    if (qc > 0) parts.push(`${qc} question(s)`);
    if (vc > 0) parts.push(`${vc} visibility rule(s)`);
    toast.success(`Applied ${parts.join(" + ") || "changes"}`);
    setRuleProposal(null);
  }

  // ── Field helpers ──
  function requestDeleteField(index: number) {
    const field = fields[index];
    if (!field.id) {
      setFields((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    const qs = questions.filter((q) => q.fieldIds.includes(field.id));
    const rs = rules.filter((r) => ruleReferencesField(r, field.id));
    if (qs.length === 0 && rs.length === 0) {
      setFields((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    setFieldDeleteIndex(index);
  }

  function confirmDeleteField() {
    if (fieldDeleteIndex === null) return;
    const index = fieldDeleteIndex;
    const field = fields[index];
    setFieldDeleteIndex(null);
    if (!field?.id) {
      setFields((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    const fid = field.id;
    setQuestions((prev) => {
      const next = prev
        .map((q) => ({
          ...q,
          fieldIds: q.fieldIds.filter((x) => x !== fid),
        }))
        .filter((q) => q.fieldIds.length > 0);
      return next.map((q, i) => ({ ...q, sort_order: i }));
    });
    setRules((prev) => prev.filter((r) => !ruleReferencesField(r, fid)));
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Rendering ──

  if (pageLoading) return <PropertyEditorSkeleton />;
  if (error) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const isNew = !description.trim() && fields.length === 0 && questions.length === 0 && rules.length === 0;

  async function copyShareLink() {
    const url = `${window.location.origin}/chat/${id}`;
    await navigator.clipboard.writeText(url);
    toast.success("Chat link copied — share it with applicants");
  }

  return (
    <>
      {/* ── Sticky sub-header ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-black/8 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Link href="/" className="shrink-0 text-[#1a2e2a]/45 transition-colors hover:text-[#1a2e2a]">
              Properties
            </Link>
            <span className="text-[#1a2e2a]/20">/</span>
            <span className="truncate font-medium text-[#1a2e2a]">
              {title || "Untitled"}
            </span>
            <span className="ml-1 text-xs text-[#1a2e2a]/30">
              {fields.length} field{fields.length !== 1 ? "s" : ""} · {questions.length} question{questions.length !== 1 ? "s" : ""} · {rules.length} rule{rules.length !== 1 ? "s" : ""}
            </span>
            <span className="ml-1.5 shrink-0 text-[#1a2e2a]/25" aria-hidden>
              ·
            </span>
            <span
              className="shrink-0 text-[11px] tabular-nums text-[#1a2e2a]/30"
              aria-live="polite"
            >
              {saving
                ? "Saving…"
                : showSaved && !dirty
                  ? "Saved"
                  : dirty
                    ? "Unsaved — saves automatically"
                    : "All changes saved"}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => void copyShareLink()} className="flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a]/50 transition-colors hover:bg-[#f7f9f8] hover:text-[#1a2e2a]">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M10.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM4.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM5 7h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              Share link
            </button>
            <button
              type="button"
              onClick={async () => {
                await flushSave();
                window.open(`/chat/${id}`, "_blank");
              }}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              Preview →
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">

        {/* Onboarding guide */}
        {isNew && (
          <section className="rounded-xl border border-teal-200 bg-teal-50/60 p-5">
            <h2 className="text-sm font-semibold text-teal-900">Quick setup</h2>
            <ol className="mt-2 space-y-1.5 text-sm text-teal-800/70">
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-700 text-[10px] font-bold text-white">1</span>
                Name your property and paste the listing description below
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-700 text-[10px] font-bold text-white">2</span>
                Define <strong>fields</strong> (data to collect), then create <strong>questions</strong> linked to those fields
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-700 text-[10px] font-bold text-white">3</span>
                Add <strong>rules</strong> for auto-rejection or acceptance profiles, then <strong>Share link</strong> with applicants
              </li>
            </ol>
          </section>
        )}

        {/* Property details card */}
        <section className="rounded-xl border border-black/8 bg-white shadow-sm">
          <div className="space-y-4 p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1a2e2a]/40">
              Property details
            </h2>
            <input
              type="text"
              placeholder="Property title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-2.5 text-base font-semibold text-foreground placeholder:font-normal placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
            <textarea
              ref={descRef}
              placeholder="Describe your property — rent, rules, requirements, pet policy, lease length, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[120px] w-full resize-none overflow-hidden rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>
        </section>

        {/* Configuration card */}
        <section className="rounded-xl border border-black/8 bg-white shadow-sm">
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-black/5 px-6 pt-1">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  if (activeTab === "Fields" && tab !== "Fields") {
                    setFields(prev => prev.filter(f => f.id.trim() !== "" || f.label.trim() !== ""));
                  }
                  setActiveTab(tab);
                }}
                className={`px-3 py-3 text-sm font-medium transition-colors ${activeTab === tab
                  ? "border-b-2 border-teal-700 text-teal-700"
                  : "text-foreground/45 hover:text-foreground/70"
                  }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* ── Fields Tab ── */}
            {activeTab === "Fields" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground/80">Data schema</h3>
                  <p className="text-xs text-foreground/40">
                    Define fields to store (used by screening rules and interview questions). Expand{" "}
                    <strong className="text-foreground/55">Show field only when…</strong> on a field to
                    gate it until other answers match (e.g. second occupant only if adults ≥ 2). Eligibility
                    reject/require rules stay on the Rules tab.
                  </p>
                </div>

                <LandlordFieldsSection
                  fields={fields}
                  onChange={setFields}
                  allFields={fields}
                  rules={rules}
                  onRulesChange={setRules}
                  onBeforeDelete={(field, index) => {
                    requestDeleteField(index);
                    return false;
                  }}
                />
              </div>
            )}

            {/* ── Questions Tab ── */}
            {activeTab === "Questions" && (
              <div className="space-y-4">
                {/* Generate prompt */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={questionsPrompt}
                    onChange={(e) => setQuestionsPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !loadingPhase && questionsPrompt.trim()) {
                        e.preventDefault();
                        void handleGenerateQuestions(questionsPrompt).then(() => setQuestionsPrompt(""));
                      }
                    }}
                    placeholder="e.g. Ask about number of occupants, pets, income, and move-in date"
                    className="flex-1 rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                  />
                  <button
                    type="button"
                    onClick={() => void handleGenerateQuestions(questionsPrompt).then(() => setQuestionsPrompt(""))}
                    disabled={!questionsPrompt.trim() || loadingPhase !== null}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100 disabled:opacity-40"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M7 1v3M7 10v3M1 7h3M10 7h3M2.75 2.75l2.12 2.12M9.13 9.13l2.12 2.12M11.25 2.75l-2.12 2.12M4.87 9.13l-2.12 2.12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                    {loadingPhase === "questions" ? "Generating…" : "Generate"}
                  </button>
                </div>

                <FlowEditor
                  questions={questions}
                  fields={fields}
                  onChange={setQuestions}
                />
              </div>
            )}

            {/* ── Rules Tab ── */}
            {activeTab === "Rules" && (
              <div className="space-y-6">
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-foreground/40">
                    Describe what rules to create — e.g. rejection criteria or acceptance profiles.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={rulesPrompt}
                      onChange={(e) => setRulesPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !loadingPhase && rulesPrompt.trim()) {
                          e.preventDefault();
                          void handleGenerateRules(rulesPrompt).then(() => setRulesPrompt(""));
                        }
                      }}
                      placeholder="e.g. Reject smokers. Allow max 2 adults, or 3 if family with child."
                      className="flex-1 rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    />
                    <button
                      type="button"
                      onClick={() => void handleGenerateRules(rulesPrompt).then(() => setRulesPrompt(""))}
                      disabled={!rulesPrompt.trim() || loadingPhase !== null || fields.length === 0}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100 disabled:opacity-40"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                        <path d="M7 1v3M7 10v3M1 7h3M10 7h3M2.75 2.75l2.12 2.12M9.13 9.13l2.12 2.12M11.25 2.75l-2.12 2.12M4.87 9.13l-2.12 2.12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                      {loadingPhase === "rules" ? "Generating…" : "Generate"}
                    </button>
                  </div>
                </div>
                <RulesSection
                  fields={fields}
                  rules={rules}
                  onChange={setRules}
                />
              </div>
            )}

            {/* ── Links Tab ── */}
            {activeTab === "Links" && (
              <div className="space-y-5">
                <p className="text-sm text-foreground/60">
                  Shared with qualified applicants at the end of the screening.
                </p>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">Video tour link</label>
                  <input type="url" placeholder="https://…" value={links.videoUrl} onChange={(e) => setLinks((prev) => ({ ...prev, videoUrl: e.target.value }))} className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm focus:border-teal-700/40 focus:bg-white focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">Booking link</label>
                  <input type="url" placeholder="https://…" value={links.bookingUrl} onChange={(e) => setLinks((prev) => ({ ...prev, bookingUrl: e.target.value }))} className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm focus:border-teal-700/40 focus:bg-white focus:outline-none" />
                </div>
              </div>
            )}

            {/* ── AI Behavior Tab ── */}
            {activeTab === "AI Behavior" && (
              <div className="space-y-6">
                <div className="space-y-4 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-5">
                  <h3 className="text-sm font-medium text-foreground/80">Conversation controls</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground/60">Off-topic limit</label>
                      <p className="text-[11px] text-foreground/35">Consecutive off-topic messages before auto-rejection. 0 = unlimited.</p>
                      <input type="number" min={0} value={aiInstructions.offTopicLimit ?? 3} onChange={(e) => setAiInstructions((prev) => ({ ...prev, offTopicLimit: Math.max(0, parseInt(e.target.value) || 0) }))} className="w-24 rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground/60">Post-qualified follow-ups</label>
                      <p className="text-[11px] text-foreground/35">Messages allowed after qualification. 0 = close immediately.</p>
                      <input type="number" min={0} value={aiInstructions.qualifiedFollowUps ?? 3} onChange={(e) => setAiInstructions((prev) => ({ ...prev, qualifiedFollowUps: Math.max(0, parseInt(e.target.value) || 0) }))} className="w-24 rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">Unknown info handling</label>
                    <p className="text-[11px] text-foreground/35">When an applicant asks about something not in the description.</p>
                    <div className="flex gap-4 pt-1">
                      <label className="flex items-center gap-2 text-sm text-foreground/70">
                        <input type="radio" name="unknownInfo" checked={(aiInstructions.unknownInfoBehavior ?? "deflect") === "deflect"} onChange={() => setAiInstructions((prev) => ({ ...prev, unknownInfoBehavior: "deflect" }))} className="accent-teal-700" />
                        Say &quot;I don&apos;t know, contact landlord&quot;
                      </label>
                      <label className="flex items-center gap-2 text-sm text-foreground/70">
                        <input type="radio" name="unknownInfo" checked={aiInstructions.unknownInfoBehavior === "ignore"} onChange={() => setAiInstructions((prev) => ({ ...prev, unknownInfoBehavior: "ignore" }))} className="accent-teal-700" />
                        Redirect to screening
                      </label>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-5">
                  <h3 className="text-sm font-medium text-foreground/80">Eligibility responses</h3>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">First concern (clarification)</label>
                    <p className="text-[11px] text-foreground/35">How the AI should respond when an applicant first fails a rule.</p>
                    <textarea rows={2} value={aiInstructions.clarificationPrompt} onChange={(e) => setAiInstructions((prev) => ({ ...prev, clarificationPrompt: e.target.value }))} placeholder="e.g. Let the applicant know their answer doesn't meet the requirement and give them a chance to correct it." className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">Confirmed rejection</label>
                    <p className="text-[11px] text-foreground/35">How the AI should respond when an applicant still fails after clarification.</p>
                    <textarea rows={2} value={aiInstructions.rejectionPrompt} onChange={(e) => setAiInstructions((prev) => ({ ...prev, rejectionPrompt: e.target.value }))} placeholder="e.g. Let the applicant know they don't meet the requirement, state the reason, and close the conversation." className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/80">Style instructions</label>
                  <p className="text-xs text-foreground/40">Tell the AI how to behave — tone, formatting, how to handle specific situations.</p>
                  <textarea rows={5} value={aiInstructions.style} onChange={(e) => setAiInstructions((prev) => ({ ...prev, style: e.target.value }))} placeholder="e.g. Be concise. Use a friendly but professional tone." className="w-full resize-none rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium text-foreground/80">Example conversations</label>
                      <p className="text-xs text-foreground/40">Show the AI how you want it to respond in specific scenarios.</p>
                    </div>
                    <button type="button" onClick={() => setAiInstructions((prev) => ({ ...prev, examples: [...(prev.examples ?? []), { user: "", assistant: "" }] }))} className="text-sm text-teal-700 hover:underline">
                      + Add example
                    </button>
                  </div>
                  {(aiInstructions.examples ?? []).length === 0 && (
                    <p className="text-sm text-foreground/30">No examples yet.</p>
                  )}
                  {(aiInstructions.examples ?? []).map((ex, i) => (
                    <div key={i} className="space-y-2 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/35">Example {i + 1}</span>
                        <button type="button" onClick={() => setAiInstructions((prev) => ({ ...prev, examples: (prev.examples ?? []).filter((_, j) => j !== i) }))} className="text-xs text-foreground/30 hover:text-red-500">Remove</button>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-foreground/50">Tenant says:</label>
                        <input type="text" value={ex.user} onChange={(e) => { const next = [...(aiInstructions.examples ?? [])]; next[i] = { ...next[i], user: e.target.value }; setAiInstructions((prev) => ({ ...prev, examples: next })); }} placeholder="e.g. Is the apartment pet-friendly?" className="w-full rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-foreground/50">AI should respond:</label>
                        <textarea rows={2} value={ex.assistant} onChange={(e) => { const next = [...(aiInstructions.examples ?? [])]; next[i] = { ...next[i], assistant: e.target.value }; setAiInstructions((prev) => ({ ...prev, examples: next })); }} placeholder="e.g. We do allow small pets with a $500 deposit. Do you have any pets?" className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <RuleProposalModal
        open={!!ruleProposal}
        proposal={ruleProposal}
        existingRules={rules}
        existingQuestions={questions}
        existingFields={fields}
        onConfirm={applyProposal}
        onCancel={() => setRuleProposal(null)}
      />

      <ConfirmDialog
        open={fieldDeleteIndex !== null}
        title="Delete this field?"
        description={
          fieldDeleteIndex === null
            ? ""
            : (() => {
                const field = fields[fieldDeleteIndex];
                if (!field?.id) return "";
                const qs = questions.filter((q) => q.fieldIds.includes(field.id));
                const rs = rules.filter((r) => ruleReferencesField(r, field.id));
                const lines: string[] = [
                  `Field “${field.label || field.id}” (${field.id}) is still in use.`,
                  "",
                  qs.length > 0
                    ? `Questions that reference it (${qs.length}):\n${qs.map((q) => `• ${q.text.slice(0, 120)}${q.text.length > 120 ? "…" : ""} [${q.fieldIds.join(", ")}]`).join("\n")}`
                    : "Questions: none",
                  "",
                  rs.length > 0
                    ? `Rules that reference it (${rs.length}) — these will be removed:\n${rs.map((r) => `• ${summarizeRule(r)}`).join("\n")}`
                    : "Rules: none",
                  "",
                  "Questions will have this field unlinked. Any question left with no fields will be removed.",
                ];
                return lines.join("\n");
              })()
        }
        confirmLabel="Delete field"
        destructive
        onConfirm={() => confirmDeleteField()}
        onCancel={() => setFieldDeleteIndex(null)}
      />
    </>
  );
}
