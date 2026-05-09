"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { PropertyRecord, PropertyLinks, AiInstructions, PropertyVariable } from "@/lib/property";
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
import { ShareLinkModal } from "@/app/components/ShareLinkModal";
import { RuleProposalModal, type Proposal } from "@/app/components/RuleProposalModal";
import LandlordFieldsSection from "@/app/components/LandlordFieldsSection";
import VariablesSection from "@/app/components/VariablesSection";
import QuestionMentionTextarea from "@/app/components/QuestionMentionTextarea";

const TABS = ["Details", "Fields", "Questions", "Variables", "Rules", "Links", "AI Behavior"] as const;
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
  const [variables, setVariables] = useState<PropertyVariable[]>([]);
  const [rules, setRules] = useState<LandlordRule[]>([]);
  const [links, setLinks] = useState<PropertyLinks>(DEFAULT_LINKS);
  const [aiInstructions, setAiInstructions] = useState<AiInstructions>(DEFAULT_AI_INSTRUCTIONS);
  const [slug, setSlug] = useState("");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const renameDialogRef = useRef<HTMLDialogElement>(null);

  const [activeTab, setActiveTab] = useState<Tab>("Details");
  const [loadingPhase, setLoadingPhase] = useState<null | "questions" | "rules">(null);
  const [saving, setSaving] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedRef] = useState(() => ({ current: "" }));
  const [showSaved, setShowSaved] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<(_?: Partial<PropertyRecord>) => Promise<{error?: any} | void>>(async () => {});
  const serializedStateRef = useRef("");
  const hasLoadedRef = useRef(false);
  const [questionsPrompt, setQuestionsPrompt] = useState("");
  const [questionsAiOpen, setQuestionsAiOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
      setVariables((p.variables as PropertyVariable[]) ?? []);
      setLinks({ ...DEFAULT_LINKS, ...(p.links as Partial<PropertyLinks>) });
      setAiInstructions(resolveAiInstructions(p.ai_instructions));
      setSlug(p.slug || id);

      lastSavedRef.current = JSON.stringify({
        title: p.title, description: p.description,
        fields: (p.fields as LandlordField[]) ?? [],
        questions: ((p.questions as Question[]) ?? []).map((q) => ({ ...q, branches: q.branches ?? [] })),
        rules: migratedRules,
        variables: (p.variables as PropertyVariable[]) ?? [],
        links: { ...DEFAULT_LINKS, ...(p.links as Partial<PropertyLinks>) },
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
    const current = JSON.stringify({ title, description, fields, questions, variables, rules, links, aiInstructions });
    setDirty(current !== lastSavedRef.current);
  }, [title, description, fields, questions, variables, rules, links, aiInstructions, pageLoading, lastSavedRef]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) { e.preventDefault(); }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const el = renameDialogRef.current;
    if (!el) return;
    if (renameModalOpen && !el.open) {
      setRenameValue(title);
      el.showModal();
    } else if (!renameModalOpen && el.open) {
      el.close();
    }
  }, [renameModalOpen, title]);

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!renameValue.trim() || renameValue.trim() === title) {
      setRenameModalOpen(false);
      return;
    }
    setRenamePending(true);
    const res = await save({ title: renameValue.trim() });
    setRenamePending(false);
    if (!res?.error) {
      setRenameModalOpen(false);
    }
  }

  // ── Save ──
  const save = useCallback(
    async (overrides?: Partial<PropertyRecord>) => {
      setSaving(true);
      
      const titleToSave = overrides?.title !== undefined ? overrides.title : title;
      const newTitle = titleToSave.trim() || "New Property";
      const newSlug = newTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

      const { error } = await supabase
        .from("properties")
        .update({
          title: newTitle,
          slug: newSlug,
          description: description.trim(),
          fields,
          questions,
          variables,
          rules,
          links,
          ai_instructions: aiInstructions,
          updated_at: new Date().toISOString(),
          ...overrides,
        })
        .eq("id", id);
      setSaving(false);
      if (error) { 
        console.error("[save]", error); 
        if (error.code === '23505') {
            toast.error("A property with this name already exists. Please choose a unique name.");
        } else {
            toast.error("Failed to save"); 
        }
        return { error };
      }
      else {
        if (overrides?.title !== undefined) {
          setTitle(newTitle);
        }
        setSlug(newSlug);
        lastSavedRef.current = JSON.stringify({ title: newTitle, description, fields, questions, variables, rules, links, aiInstructions });
        setDirty(false);
        if (savedIndicatorTimerRef.current) clearTimeout(savedIndicatorTimerRef.current);
        setShowSaved(true);
        savedIndicatorTimerRef.current = setTimeout(() => {
          setShowSaved(false);
          savedIndicatorTimerRef.current = null;
        }, 2000);
        return { error: null };
      }
    },
    [id, title, description, fields, questions, variables, rules, links, aiInstructions, supabase], // eslint-disable-line react-hooks/exhaustive-deps
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
    title, description, fields, questions, variables, rules, links, aiInstructions,
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
    variables,
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
            variables: state.variables,
            rules: state.rules,
            links: state.links,
            ai_instructions: state.aiInstructions,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .then(({ error }) => { if (error) console.error("[unmount-save]", error.message ?? error); });
      } catch { /* serialization error — skip */ }
    };
  }, [id, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate questions with prompt ──
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      let secs = 0;
      recordingTimerRef.current = setInterval(() => {
        secs += 1;
        setRecordingSeconds(secs);
        if (secs >= 300) stopRecording();
      }, 1000);
    } catch {
      toast.error("Microphone access denied");
    }
  }

  async function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setIsRecording(false);
    setIsTranscribing(true);
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      if (recorder.state !== "inactive") recorder.stop();
      else resolve();
    });
    recorder.stream.getTracks().forEach((t) => t.stop());
    mediaRecorderRef.current = null;
    try {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const form = new FormData();
      form.append("file", blob, "recording.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      if (!res.ok) throw new Error("Transcription failed");
      const { text } = await res.json() as { text: string };
      if (text.trim()) setQuestionsPrompt(text.trim());
    } catch {
      toast.error("Transcription failed — please try again");
    } finally {
      setIsTranscribing(false);
      setRecordingSeconds(0);
      audioChunksRef.current = [];
    }
  }

  async function handleGenerateQuestions(prompt: string) {
    if (!prompt.trim()) {
      toast.error("Enter a prompt describing what questions to generate");
      return;
    }
    try {
      setLoadingPhase("questions");

      // Resolve @[question text] mentions → inject full question JSON as context
      const mentionTexts = [...prompt.matchAll(/@\[([^\]]+)\]/g)]
        .map((m) => m[1].trim())
        .filter((t) => t.length > 0);
      let description = prompt;
      if (mentionTexts.length > 0) {
        const mentionedQuestions = mentionTexts.flatMap((text) => {
          const exact = questions.find((q) => q.text === text);
          if (exact) return [exact];
          const lower = text.toLowerCase();
          return questions.filter((q) => q.text.toLowerCase().includes(lower));
        });
        const unique = [...new Map(mentionedQuestions.map((q) => [q.id, q])).values()];
        if (unique.length > 0) {
          description += `\n\nREFERENCED QUESTIONS (with full branch structure — modify or extend these as needed):\n${JSON.stringify(unique, null, 2)}`;
        }
      }

      const res = await fetch("/api/generate-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          existingFields: fields.map((f) => ({ id: f.id, label: f.label, value_kind: f.value_kind })),
          existingQuestions: questions.map((q) => ({ id: q.id, text: q.text, fieldIds: q.fieldIds })),
          variables,
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

      if (proposedFields.length === 0 && proposedQuestions.length === 0 && deletedQuestionIds.length === 0) {
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
      });
    } catch (err) {
      console.error("[generateQuestions]", err);
      toast.error("Generation failed — please try again");
    } finally {
      setLoadingPhase(null);
    }
  }

  // ── Generate specific question with prompt ──
  async function handleGenerateTargeted(prompt: string, question: Question) {
    try {
      const res = await fetch("/api/generate-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: `Modify this specific question and its branches to: ${prompt}. \n\nIMPORTANT: Return EXACTLY ONE question in the 'questions' array, which must have the id "${question.id}". Here is the current JSON of the question:\n${JSON.stringify(question, null, 2)}`,
          existingFields: fields.map((f) => ({ id: f.id, label: f.label, value_kind: f.value_kind })),
          existingQuestions: [{ id: question.id, text: question.text, fieldIds: question.fieldIds }],
        }),
      });
      const data = await res.json();

      if (data.ok === false) {
        toast.error(data.error ?? "Generation failed");
        return {};
      }

      const proposedFields: LandlordField[] = data.newFields ?? [];
      const proposedQuestions: Question[] = data.questions ?? [];

      let updatedQ = proposedQuestions.find(q => q.id === question.id) || proposedQuestions[0];
      if (!updatedQ) {
        toast.error("AI didn't return an updated question");
        return {};
      }

      // Force same ID to ensure we replace the exact targeted question in FlowEditor
      updatedQ = { ...updatedQ, id: question.id };

      if (proposedFields.length > 0) {
        setFields(prev => [...prev, ...proposedFields.map(f => ({ ...f, _isNew: true, _clientId: generateId() }) as unknown as LandlordField)]);
      }

      toast.success("Question updated via AI");
      return { updatedQuestion: updatedQ };
    } catch (err) {
      console.error("[generateTargeted]", err);
      toast.error("Generation failed — please try again");
      return {};
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
        const res2 = await fetch("/api/generate-fields", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
             description: `We are building new screening rules that require these NEW fields (not in the schema yet): ${newFieldsDesc}. We need interview questions to collect them.\n\nIMPORTANT: Look at EXISTING QUESTIONS in the system context. If any existing question is on the same topic as these fields (e.g. house rules, smoking, pets, drugs, income — or one combined "policies" style question), UPDATE that question: keep its id, add the new field id(s) to fieldIds, and rewrite the question text so it naturally asks for everything in one place. Only add a brand-new question if no existing question is a good fit. Prefer merging related checks into one question when it stays readable.`,
             existingFields: fields.map((f) => ({ id: f.id, label: f.label, value_kind: f.value_kind })),
             existingQuestions: questions.map((q) => ({ id: q.id, text: q.text, fieldIds: q.fieldIds })),
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
            next[idx] = { ...next[idx], text: pq.text, fieldIds: pq.fieldIds };
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

    // 3. Delete / modify / add rules
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
      return next;
    });

    const parts: string[] = [];
    const rc = ruleProposal.newRules.length + ruleProposal.modifiedRules.length + ruleProposal.deletedRuleIds.length;
    const fc = ruleProposal.newFields.length;
    const qc = ruleProposal.proposedQuestions.length + ruleProposal.deletedQuestionIds.length;
    if (rc > 0) parts.push(`${rc} rule(s)`);
    if (fc > 0) parts.push(`${fc} field(s)`);
    if (qc > 0) parts.push(`${qc} question(s)`);
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

  return (
    <>
      {/* ── Sticky sub-header ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-black/8 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
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
            <button type="button" onClick={() => setShareModalOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a]/50 transition-colors hover:bg-[#f7f9f8] hover:text-[#1a2e2a]">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M10.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM4.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM5 7h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              Share link
            </button>
            <button
              type="button"
              onClick={async () => {
                await flushSave();
                window.open(`/chat/${slug}`, "_blank");
              }}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              Preview →
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">

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

        {/* Configuration card */}
        <section className="rounded-xl border border-black/8 bg-white shadow-sm">
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-black/5 px-6 pt-1">
            {TABS.map((tab) => {
              const count =
                tab === "Fields" ? fields.length :
                tab === "Questions" ? questions.length :
                tab === "Rules" ? rules.length :
                tab === "Variables" ? variables.length :
                0;
              return (
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
                    : "text-foreground/60 hover:text-foreground/70"
                    }`}
                >
                  {tab}
                  {count > 0 && (
                    <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${activeTab === tab ? "bg-teal-100 text-teal-700" : "bg-foreground/8 text-foreground/40"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="p-6">
            {/* ── Details Tab ── */}
            {activeTab === "Details" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground/80">Property details</h3>
                  <p className="text-xs text-foreground/60">
                    Set the title and provide a detailed description of the property. This description is used by the AI to answer applicant questions.
                  </p>
                </div>
                <div className="flex items-center gap-4 w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-2.5">
                  <div className="text-base font-semibold text-foreground flex-1 truncate">
                    {title || "Untitled"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRenameModalOpen(true)}
                    className="shrink-0 rounded-md border border-black/10 bg-white px-3 py-1 text-xs font-medium text-[#1a2e2a]/70 shadow-sm transition-colors hover:bg-black/5 hover:text-[#1a2e2a]"
                  >
                    Rename
                  </button>
                </div>
                <textarea
                  ref={descRef}
                  placeholder="Describe your property — rent, rules, requirements, pet policy, lease length, etc."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[120px] w-full resize-none overflow-hidden rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-3 text-sm text-foreground placeholder:text-foreground/70 focus:border-teal-700/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                />
              </div>
            )}

            {/* ── Fields Tab ── */}
            {activeTab === "Fields" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground/80">Data schema</h3>
                  <p className="text-xs text-foreground/60">
                    Define fields to store (used by screening rules and interview questions). Eligibility
                    reject/require rules stay on the Rules tab.
                  </p>
                </div>

                <LandlordFieldsSection
                  fields={fields}
                  onChange={setFields}
                  allFields={fields}
                  onBeforeDelete={(field, index) => {
                    requestDeleteField(index);
                    return false;
                  }}
                />
              </div>
            )}

            {/* ── Questions Tab ── */}
            {activeTab === "Questions" && (
              <div className="relative space-y-4">
                <FlowEditor
                  questions={questions}
                  fields={fields}
                  customVariables={variables}
                  onChange={setQuestions}
                  onGenerateTargeted={handleGenerateTargeted}
                  onCreateField={(label) => {
                    const baseId = label
                      ? label.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "_").slice(0, 40)
                      : "new_field";
                    let newId = baseId || "new_field";
                    if (fields.some(f => f.id === newId)) {
                      newId = `${newId}_${generateId()}`;
                    }
                    const newField = {
                      id: newId,
                      label: label || "New Field",
                      value_kind: "text" as const,
                      _isNew: true,
                      _clientId: generateId()
                    } as unknown as LandlordField;
                    setFields(prev => [...prev, newField]);
                    return newId;
                  }}
                />

                {/* Floating AI button */}
                <div className="absolute bottom-4 right-4">
                  {questionsAiOpen ? (
                    <div className="flex w-80 flex-col gap-2 rounded-xl border border-teal-700/20 bg-white p-3 shadow-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground/60">Generate with AI</span>
                        <button
                          type="button"
                          onClick={() => { setQuestionsAiOpen(false); setQuestionsPrompt(""); }}
                          aria-label="Close"
                          className="rounded p-0.5 text-foreground/40 hover:text-foreground/70"
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                      <QuestionMentionTextarea
                        rows={4}
                        value={questionsPrompt}
                        onChange={setQuestionsPrompt}
                        questions={questions}
                        onKeyDown={(e) => { if (e.key === "Escape") { setQuestionsAiOpen(false); setQuestionsPrompt(""); } }}
                        placeholder="e.g. Ask about number of occupants, pets, income, and move-in date — type @ to reference a question"
                        autoFocus
                        disabled={isTranscribing}
                        className="w-full resize-none rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm text-foreground placeholder:text-foreground/50 focus:border-teal-700/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20 disabled:opacity-50"
                      />
                      <div className="flex items-center gap-2">
                        {/* Mic button */}
                        <button
                          type="button"
                          onClick={() => void (isRecording ? stopRecording() : startRecording())}
                          disabled={isTranscribing || loadingPhase !== null}
                          aria-label={isRecording ? "Stop recording" : "Start recording"}
                          className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${isRecording ? "bg-red-500 text-white" : "bg-foreground/8 text-foreground/60 hover:bg-foreground/12 hover:text-foreground/80"}`}
                        >
                          {isRecording && (
                            <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-50" />
                          )}
                          {isTranscribing ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden>
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeDasharray="40 20" />
                            </svg>
                          ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <rect x="9" y="2" width="6" height="13" rx="3" fill="currentColor" />
                              <path d="M5 10a7 7 0 0014 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          )}
                        </button>
                        {/* Timer */}
                        {isRecording && (
                          <span className="font-mono text-xs tabular-nums text-red-500">
                            {`${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, "0")}`}
                            <span className="ml-1 text-red-400/70">/ 5:00</span>
                          </span>
                        )}
                        <div className="ml-auto">
                          <button
                            type="button"
                            onClick={() => void handleGenerateQuestions(questionsPrompt).then(() => { setQuestionsPrompt(""); setQuestionsAiOpen(false); })}
                            disabled={!questionsPrompt.trim() || loadingPhase !== null || isRecording || isTranscribing}
                            className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-teal-800 disabled:opacity-60"
                          >
                            {loadingPhase === "questions" ? "Generating…" : "Generate with AI"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setQuestionsAiOpen(true)}
                      aria-label="Generate with AI"
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-700 text-white shadow-md transition-colors hover:bg-teal-800"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" fill="currentColor" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Variables Tab ── */}
            {activeTab === "Variables" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground/80">Template variables</h3>
                  <p className="text-xs text-foreground/60">
                    Define custom variables to insert into question text using{" "}
                    <code className="font-mono text-[11px]">{"{{key}}"}</code> syntax.
                  </p>
                </div>
                <VariablesSection variables={variables} onChange={setVariables} />
              </div>
            )}

            {/* ── Rules Tab ── */}
            {activeTab === "Rules" && (
              <div className="space-y-6">
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-foreground/60">
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
                      className="flex-1 rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm text-foreground placeholder:text-foreground/70 focus:border-teal-700/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    />
                    <button
                      type="button"
                      onClick={() => void handleGenerateRules(rulesPrompt).then(() => setRulesPrompt(""))}
                      disabled={!rulesPrompt.trim() || loadingPhase !== null || fields.length === 0}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-800 disabled:opacity-60"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                        <path d="M7 1v3M7 10v3M1 7h3M10 7h3M2.75 2.75l2.12 2.12M9.13 9.13l2.12 2.12M11.25 2.75l-2.12 2.12M4.87 9.13l-2.12 2.12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                      {loadingPhase === "rules" ? "Generating…" : "Generate with AI"}
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
                  <input type="url" placeholder="https://…" value={links.videoUrl} onChange={(e) => setLinks((prev) => ({ ...prev, videoUrl: e.target.value }))} className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm focus:border-teal-700/60 focus:bg-white focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">Booking link</label>
                  <input type="url" placeholder="https://…" value={links.bookingUrl} onChange={(e) => setLinks((prev) => ({ ...prev, bookingUrl: e.target.value }))} className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm focus:border-teal-700/60 focus:bg-white focus:outline-none" />
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
                      <p className="text-[11px] text-foreground/55">Consecutive off-topic messages before auto-rejection. 0 = unlimited.</p>
                      <input type="number" min={0} value={aiInstructions.offTopicLimit ?? 3} onChange={(e) => setAiInstructions((prev) => ({ ...prev, offTopicLimit: Math.max(0, parseInt(e.target.value) || 0) }))} className="w-24 rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/60 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground/60">Post-qualified follow-ups</label>
                      <p className="text-[11px] text-foreground/55">Messages allowed after qualification. 0 = close immediately.</p>
                      <input type="number" min={0} value={aiInstructions.qualifiedFollowUps ?? 3} onChange={(e) => setAiInstructions((prev) => ({ ...prev, qualifiedFollowUps: Math.max(0, parseInt(e.target.value) || 0) }))} className="w-24 rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/60 focus:outline-none" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">Unknown info handling</label>
                    <p className="text-[11px] text-foreground/55">When an applicant asks about something not in the description.</p>
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
                    <p className="text-[11px] text-foreground/55">How the AI should respond when an applicant first fails a rule.</p>
                    <textarea rows={2} value={aiInstructions.clarificationPrompt} onChange={(e) => setAiInstructions((prev) => ({ ...prev, clarificationPrompt: e.target.value }))} placeholder="e.g. Let the applicant know their answer doesn't meet the requirement and give them a chance to correct it." className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/70 focus:border-teal-700/60 focus:outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">Confirmed rejection</label>
                    <p className="text-[11px] text-foreground/55">How the AI should respond when an applicant still fails after clarification.</p>
                    <textarea rows={2} value={aiInstructions.rejectionPrompt} onChange={(e) => setAiInstructions((prev) => ({ ...prev, rejectionPrompt: e.target.value }))} placeholder="e.g. Let the applicant know they don't meet the requirement, state the reason, and close the conversation." className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/70 focus:border-teal-700/60 focus:outline-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/80">Style instructions</label>
                  <p className="text-xs text-foreground/60">Tell the AI how to behave — tone, formatting, how to handle specific situations.</p>
                  <textarea rows={5} value={aiInstructions.style} onChange={(e) => setAiInstructions((prev) => ({ ...prev, style: e.target.value }))} placeholder="e.g. Be concise. Use a friendly but professional tone." className="w-full resize-none rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-3 text-sm text-foreground placeholder:text-foreground/70 focus:border-teal-700/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium text-foreground/80">Example conversations</label>
                      <p className="text-xs text-foreground/60">Show the AI how you want it to respond in specific scenarios.</p>
                    </div>
                    <button type="button" onClick={() => setAiInstructions((prev) => ({ ...prev, examples: [...(prev.examples ?? []), { user: "", assistant: "" }] }))} className="text-sm text-teal-700 hover:underline">
                      + Add example
                    </button>
                  </div>
                  {(aiInstructions.examples ?? []).length === 0 && (
                    <p className="text-sm text-foreground/70">No examples yet.</p>
                  )}
                  {(aiInstructions.examples ?? []).map((ex, i) => (
                    <div key={i} className="space-y-2 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/55">Example {i + 1}</span>
                        <button type="button" onClick={() => setAiInstructions((prev) => ({ ...prev, examples: (prev.examples ?? []).filter((_, j) => j !== i) }))} className="text-xs text-foreground/70 hover:text-red-500">Remove</button>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-foreground/70">Tenant says:</label>
                        <input type="text" value={ex.user} onChange={(e) => { const next = [...(aiInstructions.examples ?? [])]; next[i] = { ...next[i], user: e.target.value }; setAiInstructions((prev) => ({ ...prev, examples: next })); }} placeholder="e.g. Is the apartment pet-friendly?" className="w-full rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/60 focus:outline-none" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-foreground/70">AI should respond:</label>
                        <textarea rows={2} value={ex.assistant} onChange={(e) => { const next = [...(aiInstructions.examples ?? [])]; next[i] = { ...next[i], assistant: e.target.value }; setAiInstructions((prev) => ({ ...prev, examples: next })); }} placeholder="e.g. We do allow small pets with a $500 deposit. Do you have any pets?" className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/60 focus:outline-none" />
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
      {renameModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-black/8 bg-white p-0 shadow-xl">
            <form onSubmit={handleRenameSubmit} className="p-6">
              <h3 className="text-sm font-semibold text-[#1a2e2a]">Rename Property</h3>
              <p className="mt-2 text-sm text-[#1a2e2a]/60">
                Enter a unique name for this property. This will be used in the chat link.
              </p>
              <div className="mt-4">
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  placeholder="e.g. 123 Main St"
                  autoFocus
                  disabled={renamePending}
                  className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none focus:ring-2 focus:ring-teal-700/20 disabled:opacity-60"
                />
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenameModalOpen(false)}
                  disabled={renamePending}
                  className="rounded-lg border border-black/10 px-4 py-2 text-sm text-[#1a2e2a]/60 transition-colors hover:bg-[#f7f9f8] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renamePending || !renameValue.trim() || renameValue.trim() === title}
                  className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {renamePending ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Link Modal */}
      <ShareLinkModal 
        open={shareModalOpen} 
        slug={slug} 
        onClose={() => setShareModalOpen(false)} 
      />
    </>
  );
}
