"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { PropertyRecord, PropertyLinks, AiInstructions, PropertyVariable, PropertyStatus } from "@/lib/property";
import { DEFAULT_AI_INSTRUCTIONS, DEFAULT_LINKS, resolveAiInstructions } from "@/lib/property";
import { validatePublishableProperty, type PublishValidationIssue } from "@/lib/property-validation";
import type { LandlordField } from "@/lib/landlord-field";
import type { Question } from "@/lib/question";
import RulesSummary from "@/app/components/RulesSummary";
import FlowEditor from "@/app/components/FlowEditor";
import { PropertyEditorSkeleton } from "@/app/components/Skeleton";
import { ConfirmDialog } from "@/app/components/ConfirmDialog";
import { DeleteFieldDialog } from "@/app/components/DeleteFieldDialog";
import { DeleteVariableDialog } from "@/app/components/DeleteVariableDialog";
import { ShareLinkModal } from "@/app/components/ShareLinkModal";
import { RuleProposalModal, type Proposal } from "@/app/components/RuleProposalModal";
import LandlordFieldsSection from "@/app/components/LandlordFieldsSection";
import VariablesSection from "@/app/components/VariablesSection";
import QuestionMentionTextarea from "@/app/components/QuestionMentionTextarea";
import { generateId } from "@/lib/id-utils";
import { isConditionValid } from "@/lib/rule-engine";
import {
  validateLandlordFieldId,
  validateLandlordFieldLabel,
  validateEnumOptions,
  NAME_FIELD,
} from "@/lib/landlord-field";

const TABS = ["Details", "Fields", "Questions", "Variables", "Rules", "Links", "AI Behavior", "Test"] as const;
type Tab = (typeof TABS)[number];

function getFieldDeleteDescription(fields: LandlordField[], questions: Question[], idx: number | null): string {
  if (idx === null) return "";
  const field = fields[idx];
  if (!field?.id) return "";
  const qs = questions.filter((q) => q.fieldIds.includes(field.id));
  const label = field.label || field.id;
  if (qs.length === 0) return 'Delete field "' + label + '" (' + field.id + ')?';
  const qList = qs.map((q) => {
    const t = q.text.length > 120 ? q.text.slice(0, 120) + "..." : q.text;
    return "- " + t;
  }).join("\n");
  const s = qs.length !== 1 ? "s" : "";
  return 'Field "' + label + '" (' + field.id + ') is referenced by ' + qs.length + " question" + s + ":\n\n" + qList + "\n\nThose questions will have this field unlinked. Any question left with no fields will be removed.";
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
  const [links, setLinks] = useState<PropertyLinks>(DEFAULT_LINKS);
  const [aiInstructions, setAiInstructions] = useState<AiInstructions>(DEFAULT_AI_INSTRUCTIONS);
  const [status, setStatus] = useState<PropertyStatus>("draft");
  const [publishIssues, setPublishIssues] = useState<PublishValidationIssue[]>([]);
  const [externalFocus, setExternalFocus] = useState<{ id: string; target: { questionId?: string; branchId?: string } } | null>(null);
  const [slug, setSlug] = useState("");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const renameDialogRef = useRef<HTMLDialogElement>(null);

  const [publishedStateStr, setPublishedStateStr] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>("Details");
  const [loadingPhase, setLoadingPhase] = useState<null | "questions">(null);
  const [saving, setSaving] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedRef] = useState(() => ({ current: "" }));
  const [showSaved, setShowSaved] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serializedStateRef = useRef("");
  const hasLoadedRef = useRef(false);
  const lastValidFieldsRef = useRef<LandlordField[]>([]);
  const lastValidVariablesRef = useRef<PropertyVariable[]>([]);

  const [questionsPrompt, setQuestionsPrompt] = useState("");
  const [questionsAiOpen, setQuestionsAiOpen] = useState(false);
  const [clarifyingQuestions, setClarifyingQuestions] = useState<string[]>([]);
  const [clarifyingAnswers, setClarifyingAnswers] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [ruleProposal, setRuleProposal] = useState<Proposal | null>(null);
  const [fieldDeleteIndex, setFieldDeleteIndex] = useState<number | null>(null);
  const [varDeleteIndex, setVarDeleteIndex] = useState<number | null>(null);

  // Test tab state
  type TestOutcome = "qualified" | "rejected" | "review" | "in_progress";
  type TestResult = {
    messages: { role: "user" | "assistant"; content: string }[];
    answers: Record<string, string>;
    outcome: TestOutcome;
    violations: string[];
  };
  const [testScenario, setTestScenario] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testSaved, setTestSaved] = useState(false);

  const descRef = useRef<HTMLTextAreaElement>(null);


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
      setStatus(p.status ?? "draft");
      setDescription(p.description);
      const loadedFields = (p.fields as LandlordField[]) ?? [];
      const hasNameField = loadedFields.some((f) => f.id === NAME_FIELD.id);
      const resolvedFields = hasNameField ? loadedFields : [NAME_FIELD, ...loadedFields];
      setFields(resolvedFields);
      lastValidFieldsRef.current = resolvedFields;
      setQuestions(((p.questions as Question[]) ?? []).map((q) => ({ ...q, branches: q.branches ?? [] })));
      const loadedVars = (p.variables as PropertyVariable[]) ?? [];
      setVariables(loadedVars);
      lastValidVariablesRef.current = loadedVars;
      setLinks({ ...DEFAULT_LINKS, ...(p.links as Partial<PropertyLinks>) });
      setAiInstructions(resolveAiInstructions(p.ai_instructions));
      setSlug(p.slug || id);

      lastSavedRef.current = JSON.stringify({
        title: p.title, description: p.description,
        status: p.status ?? "draft",
        fields: (p.fields as LandlordField[]) ?? [],
        questions: ((p.questions as Question[]) ?? []).map((q) => ({ ...q, branches: q.branches ?? [] })),
        variables: (p.variables as PropertyVariable[]) ?? [],
        links: { ...DEFAULT_LINKS, ...(p.links as Partial<PropertyLinks>) },
        aiInstructions: resolveAiInstructions(p.ai_instructions),
      });
      setPublishedStateStr(p.published_state ? JSON.stringify(p.published_state) : null);
      hasLoadedRef.current = true;
      setPageLoading(false);
    }
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dirty tracking ──
  useEffect(() => {
    if (pageLoading) return;
    const current = JSON.stringify({ title, status, description, fields, questions, variables, links, aiInstructions });
    setDirty(current !== lastSavedRef.current);
  }, [title, status, description, fields, questions, variables, links, aiInstructions, pageLoading, lastSavedRef]);

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
      const newStatus = overrides?.status ?? status;

      const { error } = await supabase
        .from("properties")
        .update({
          title: newTitle,
          status: newStatus,
          description: description.trim(),
          fields,
          questions,
          variables,
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
        setStatus(newStatus);
        lastSavedRef.current = JSON.stringify({ title: newTitle, status: newStatus, description, fields, questions, variables, links, aiInstructions });
        setDirty(false);
        if (savedIndicatorTimerRef.current) clearTimeout(savedIndicatorTimerRef.current);
        setShowSaved(true);
        savedIndicatorTimerRef.current = setTimeout(() => {
          setShowSaved(false);
          savedIndicatorTimerRef.current = null;
        }, 2000);
        if (overrides && 'published_state' in overrides) {
          setPublishedStateStr(overrides.published_state ? JSON.stringify(overrides.published_state) : null);
        }
        return { error: null };
      }
    },
    [id, title, status, description, fields, questions, variables, links, aiInstructions, supabase, lastSavedRef],
  );

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
  }, [save, lastSavedRef]);

  serializedStateRef.current = JSON.stringify({
    title, status, description, fields, questions, variables, links, aiInstructions,
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
    status,
    description,
    fields,
    questions,
    variables,
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
        const finalTitle = (state.title ?? "").trim() || "New Property";
        void supabase
          .from("properties")
          .update({
            title: finalTitle,
            status: state.status,
            description: (state.description ?? "").trim(),
            fields: state.fields,
            questions: state.questions,
            variables: state.variables,
            links: state.links,
            ai_instructions: state.aiInstructions,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .then(({ error }) => { if (error) console.error("[unmount-save]", error.message ?? error); });
      } catch { /* serialization error — skip */ }
    };
  }, [id, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  async function publishProperty() {
    const issues = validatePublishableProperty({ fields, questions });
    setPublishIssues(issues);
    if (issues.length > 0) {
      toast.error(`Fix ${issues.length} issue${issues.length === 1 ? "" : "s"} before publishing`);
      return;
    }
    const res = await save({ 
      status: "published",
      published_state: {
        title,
        description,
        fields,
        questions,
        links,
        ai_instructions: aiInstructions,
        variables,
      } as any
    });
    if (!res?.error) {
      toast.success("Property published");
    }
  }

  async function unpublishProperty() {
    const res = await save({ status: "draft", published_state: null } as any);
    if (!res?.error) {
      toast.success("Property moved to drafts");
    }
  }

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

  function buildDescription(rawPrompt: string): string {
    const mentionTexts = [...rawPrompt.matchAll(/@\[([^\]]+)\]/g)]
      .map((m) => m[1].trim())
      .filter((t) => t.length > 0);
    let description = rawPrompt;
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
    return description;
  }

  async function runGeneration(description: string): Promise<boolean> {
    const res = await fetch("/api/generate-property", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        existingFields: fields.map((f) => ({ id: f.id, label: f.label, value_kind: f.value_kind, options: f.options })),
        existingQuestions: questions.map((q) => ({ id: q.id, text: q.text, fieldIds: q.fieldIds })),
        variables,
        links,
        aiInstructions,
      }),
    });
    const data = await res.json();

    if (data.ok === false || (!res.ok && data.error)) {
      toast.error(data.error ?? "Generation failed");
      return false;
    }

    const proposedFields: LandlordField[] = data.newFields ?? [];
    const proposedQuestions: Question[] = data.questions ?? [];
    const deletedQuestionIds: string[] = data.deletedQuestionIds ?? [];

    if (
      proposedFields.length === 0 &&
      proposedQuestions.length === 0 &&
      deletedQuestionIds.length === 0 &&
      !data.variables &&
      !data.links &&
      !data.aiInstructions
    ) {
      toast.info("No new items to add — AI found everything is covered.");
      return true;
    }

    if (data.debugPlan) {
      console.log("=== AI EXPANSION PLAN (DEBUG) ===");
      console.log(data.debugPlan);
      console.log("=================================");
    }

    setRuleProposal({
      newFields: proposedFields,
      proposedQuestions,
      deletedQuestionIds,
      variables: data.variables,
      links: data.links,
      aiInstructions: data.aiInstructions,
      notesToUser: data.notesToUser,
    } as Proposal);
    return true;
  }

  async function handleGenerateQuestions(prompt: string) {
    if (!prompt.trim()) {
      toast.error("Enter a prompt describing what questions to generate");
      return;
    }
    try {
      setLoadingPhase("questions");
      const description = buildDescription(prompt);

      // Step 1: ask the AI whether it needs more context. Fail-soft: any error proceeds to generate.
      let clarifyQuestions: string[] = [];
      try {
        const clarifyRes = await fetch("/api/clarify-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            existingFields: fields.map((f) => ({ id: f.id, label: f.label, value_kind: f.value_kind, options: f.options })),
            existingQuestions: questions.map((q) => ({ id: q.id, text: q.text, fieldIds: q.fieldIds })),
            variables,
          }),
        });
        if (clarifyRes.ok) {
          const data = await clarifyRes.json();
          if (Array.isArray(data.questions)) clarifyQuestions = data.questions;
        }
      } catch (err) {
        console.warn("[clarify-prompt] failed, proceeding to generate", err);
      }

      if (clarifyQuestions.length > 0) {
        setClarifyingQuestions(clarifyQuestions);
        setClarifyingAnswers(new Array(clarifyQuestions.length).fill(""));
        return;
      }

      const ok = await runGeneration(description);
      if (ok) {
        setQuestionsPrompt("");
        setQuestionsAiOpen(false);
      }
    } catch (err) {
      console.error("[generateQuestions]", err);
      toast.error("Generation failed — please try again");
    } finally {
      setLoadingPhase(null);
    }
  }

  async function submitClarifications(skip: boolean) {
    try {
      setLoadingPhase("questions");
      let description = buildDescription(questionsPrompt);
      if (!skip) {
        const qaPairs = clarifyingQuestions
          .map((q, i) => ({ q, a: clarifyingAnswers[i]?.trim() ?? "" }))
          .filter((qa) => qa.a.length > 0);
        if (qaPairs.length > 0) {
          description += `\n\nAdditional context (clarifying answers):\n${qaPairs.map((qa) => `Q: ${qa.q}\nA: ${qa.a}`).join("\n\n")}`;
        }
      }
      const ok = await runGeneration(description);
      if (ok) {
        setClarifyingQuestions([]);
        setClarifyingAnswers([]);
        setQuestionsPrompt("");
        setQuestionsAiOpen(false);
      }
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
          existingFields: fields.map((f) => ({ id: f.id, label: f.label, value_kind: f.value_kind, options: f.options })),
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

  async function handleRunTest() {
    if (!testScenario.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    setTestSaved(false);
    try {
      const res = await fetch("/api/test-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: testScenario, title, description, fields, questions, variables }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Test generation failed"); return; }
      setTestResult(data);
    } catch {
      toast.error("Test generation failed — please try again");
    } finally {
      setTestLoading(false);
    }
  }

  async function handleSaveTest() {
    if (!testResult) return;
    try {
      const res = await fetch("/api/test-scenario/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: id,
          title,
          scenario: testScenario,
          outcome: testResult.outcome,
          answers: testResult.answers,
          messages: testResult.messages,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Save failed"); return; }
      setTestSaved(true);
      toast.success("Test session saved");
    } catch {
      toast.error("Save failed — please try again");
    }
  }

  function getAllQuestionTexts(qs: Question[]): string[] {
    const texts: string[] = [];
    for (const q of qs) {
      texts.push(q.text);
      for (const b of q.branches) {
        texts.push(...getAllQuestionTexts(b.subQuestions));
      }
    }
    return texts;
  }

  function applyProposal() {
    if (!ruleProposal) return;

    // 1. Add new fields — skip any with invalid/duplicate IDs or labels
    if (ruleProposal.newFields.length > 0) {
      setFields((prev) => {
        const existingIds = new Set(prev.map((f) => f.id));
        const existingLabels = new Set(prev.map((f) => f.label.toLowerCase()));
        const validNew = ruleProposal.newFields.filter((f) => {
          if (!f.id || validateLandlordFieldId(f.id)) return false;
          if (!f.label || validateLandlordFieldLabel(f.label)) return false;
          if (existingIds.has(f.id)) return false;
          if (existingLabels.has(f.label.toLowerCase())) return false;
          if (f.value_kind === "enum" && validateEnumOptions(f.options)) return false;
          return true;
        });
        return [...prev, ...validNew.map((f) => ({ ...f, _isNew: true, _clientId: generateId() }) as unknown as LandlordField)];
      });
    }

    // 2. Delete questions (recursively) -> upsert -> renumber
    if (ruleProposal.proposedQuestions.length > 0 || ruleProposal.deletedQuestionIds.length > 0) {
      setQuestions((prev) => {
        const deleteSet = new Set(ruleProposal.deletedQuestionIds);

        function deleteFromTree(qs: Question[]): Question[] {
          return qs
            .filter((q) => !deleteSet.has(q.id))
            .map((q) => ({
              ...q,
              branches: q.branches.map((b) => ({
                ...b,
                subQuestions: deleteFromTree(b.subQuestions),
              })),
            }));
        }

        let next = deleteSet.size > 0 ? deleteFromTree(prev) : [...prev];

        // Upsert: update existing questions, preserving branches unless AI provides new ones
        const newQs: Question[] = [];
        for (const pq of ruleProposal.proposedQuestions) {
          const idx = next.findIndex((q) => q.id === pq.id);
          if (idx >= 0) {
            next[idx] = {
              ...next[idx],
              text: pq.text,
              fieldIds: pq.fieldIds,
              branches: pq.branches?.length ? pq.branches : next[idx].branches,
            };
          } else {
            newQs.push({ ...pq, branches: pq.branches ?? [] });
          }
        }

        if (newQs.length > 0) next = [...next, ...newQs];
        return next.map((q, i) => ({ ...q, sort_order: i }));
      });
    }

    // 3. Variables — merge: keep existing referenced ones the AI omitted, upsert the rest
    if (Array.isArray(ruleProposal.variables)) {
      setVariables((prev) => {
        const allTexts = getAllQuestionTexts(questions);
        const proposalKeys = new Set(ruleProposal.variables!.map((v) => v.id));
        const protected_ = prev.filter((v) => {
          if (proposalKeys.has(v.id)) return false;
          return allTexts.some((t) => t.includes(`{{${v.id}}}`));
        });
        return [...protected_, ...ruleProposal.variables!];
      });
    }

    // 5. Links
    if (ruleProposal.links) {
      setLinks((prev) => ({ ...prev, ...ruleProposal.links }));
    }

    // 6. AI instructions — sanitize numeric fields before applying
    if (ruleProposal.aiInstructions) {
      const ai = { ...ruleProposal.aiInstructions };
      if (typeof ai.offTopicLimit === "number") {
        ai.offTopicLimit = Math.max(0, Math.round(ai.offTopicLimit));
      } else {
        delete ai.offTopicLimit;
      }
      if (typeof ai.qualifiedFollowUps === "number") {
        ai.qualifiedFollowUps = Math.max(0, Math.round(ai.qualifiedFollowUps));
      } else {
        delete ai.qualifiedFollowUps;
      }
      setAiInstructions((prev) => ({ ...prev, ...ai }));
    }

    const parts: string[] = [];
    const fc = ruleProposal.newFields.length;
    const qc = ruleProposal.proposedQuestions.length + ruleProposal.deletedQuestionIds.length;
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
    if (qs.length === 0) {
      setFields((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    setFieldDeleteIndex(index);
  }

  type Branch = import("@/lib/question").Branch;

  function stripBranches(branches: Branch[], shouldRemove: (b: Branch) => boolean): Branch[] {
    return branches
      .filter((b) => !shouldRemove(b))
      .map((b) => ({ ...b, subQuestions: b.subQuestions.map((sq) => ({ ...sq, branches: stripBranches(sq.branches, shouldRemove) })) }));
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
          branches: stripBranches(q.branches, (b) => b.condition.fieldId === fid),
        }))
        .filter((q) => q.fieldIds.length > 0);
      return next.map((q, i) => ({ ...q, sort_order: i }));
    });
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  function cascadeInvalidBranches(
    updatedFields: import("@/lib/landlord-field").LandlordField[],
    updatedVars: import("@/lib/property").PropertyVariable[],
  ) {
    const nextQuestions = questions.map((q) => ({
      ...q,
      branches: stripBranches(q.branches, (b) => !isConditionValid(b.condition, updatedFields, updatedVars)),
    }));
    const removedAny = nextQuestions.some((q, i) => q.branches.length !== questions[i].branches.length);
    setQuestions(nextQuestions);
    if (removedAny) toast.warning("Some branch conditions were removed — both sides of a condition must be the same type.");
  }

  function handleFieldsChange(updatedFields: import("@/lib/landlord-field").LandlordField[]) {
    if (updatedFields.every(f => f.label.trim())) {
      lastValidFieldsRef.current = updatedFields;
    }
    cascadeInvalidBranches(updatedFields, variables);
    setFields(updatedFields);
  }

  function handleVariablesChange(updatedVars: import("@/lib/property").PropertyVariable[]) {
    if (updatedVars.every(v => v.label.trim())) {
      lastValidVariablesRef.current = updatedVars;
    }
    cascadeInvalidBranches(fields, updatedVars);
    setVariables(updatedVars);
  }

  function getQuestionsWithVarInText(token: string): import("@/lib/question").Question[] {
    const result: import("@/lib/question").Question[] = [];
    function traverse(qs: import("@/lib/question").Question[]) {
      for (const q of qs) {
        if (q.text.includes(token)) result.push(q);
        for (const b of q.branches) traverse(b.subQuestions);
      }
    }
    traverse(questions);
    return result;
  }

  function getQuestionsWithVarInCondition(token: string): import("@/lib/question").Question[] {
    const result: import("@/lib/question").Question[] = [];
    function traverse(qs: import("@/lib/question").Question[]) {
      for (const q of qs) {
        if (q.branches.some((b) => b.condition.value.includes(token))) result.push(q);
        for (const b of q.branches) traverse(b.subQuestions);
      }
    }
    traverse(questions);
    return result;
  }

  function requestDeleteVariable(index: number) {
    const variable = variables[index];
    if (!variable.id) {
      setVariables((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    const token = `{{${variable.id}}}`;
    const hasRefs = getQuestionsWithVarInText(token).length > 0 || getQuestionsWithVarInCondition(token).length > 0;
    if (!hasRefs) {
      setVariables((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    setVarDeleteIndex(index);
  }

  function confirmDeleteVariable() {
    if (varDeleteIndex === null) return;
    const variable = variables[varDeleteIndex];
    setVarDeleteIndex(null);
    if (!variable?.id) {
      setVariables((prev) => prev.filter((_, i) => i !== varDeleteIndex));
      return;
    }
    const token = `{{${variable.id}}}`;
    const nextVars = variables.filter((_, i) => i !== varDeleteIndex);

    function processQuestions(qs: import("@/lib/question").Question[]): import("@/lib/question").Question[] {
      return qs.map((q) => ({
        ...q,
        text: q.text.split(token).join("").trim(),
        branches: q.branches
          .filter((b) => !b.condition.value.includes(token))
          .map((b) => ({ ...b, subQuestions: processQuestions(b.subQuestions) })),
      }));
    }

    const nextQuestions = processQuestions(questions);
    const removedAny = questions.some((q, i) => q.branches.length !== nextQuestions[i].branches.length);
    setQuestions(nextQuestions);
    if (removedAny) toast.warning("Some branch conditions were removed because they referenced the deleted variable.");
    setVariables(nextVars);
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

  const isNew = !description.trim() && fields.length === 0 && questions.length === 0;

  const currentStateStr = JSON.stringify({
    title, description, fields, questions, links, ai_instructions: aiInstructions, variables
  });
  const hasDraftChanges = status === "draft" || (publishedStateStr !== currentStateStr);

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
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              status === "published" ? "bg-teal-100 text-teal-800" : "bg-amber-100 text-amber-800"
            }`}>
              {status}
            </span>
            {hasDraftChanges && status === "published" && (
              <span className="ml-1 text-[11px] font-medium text-amber-600">
                Unpublished edits
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <span
              className="text-[11px] text-[#1a2e2a]/40 tabular-nums mr-2"
              aria-live="polite"
            >
              {saving
                ? "Saving…"
                : showSaved && !dirty
                  ? "Saved"
                  : dirty
                    ? "Unsaved"
                    : ""}
            </span>
            <button
              type="button"
              onClick={async () => {
                const issues = validatePublishableProperty({ fields, questions });
                setPublishIssues(issues);
                if (issues.length > 0) {
                  toast.error(`Fix ${issues.length} issue${issues.length === 1 ? "" : "s"} before previewing`);
                  return;
                }
                await flushSave();
                window.open(`/chat/${slug}?preview=1`, "_blank");
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#1a2e2a]/60 transition-colors hover:bg-black/5 hover:text-[#1a2e2a]"
            >
              Preview draft
            </button>

            <button
              type="button"
              onClick={() => {
                if (status !== "published") {
                  toast.error("Publish this property before sharing the live link");
                  return;
                }
                setShareModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a]/70 transition-colors hover:bg-[#f7f9f8] hover:text-[#1a2e2a]"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M10.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM4.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM5 7h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              Copy link
            </button>

            {status === "published" && (
              <button
                type="button"
                onClick={() => void unpublishProperty()}
                className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a]/55 transition-colors hover:bg-[#f7f9f8] hover:text-[#1a2e2a]"
              >
                Unpublish
              </button>
            )}
            {hasDraftChanges && (
              <button
                type="button"
                onClick={() => void publishProperty()}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                Publish changes
              </button>
            )}
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
                Add <strong>reject branches</strong> to your questions, then <strong>Share link</strong> with applicants
              </li>
            </ol>
          </section>
        )}

        {publishIssues.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-amber-50/80 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-amber-950">Before publishing</h2>
                <ul className="mt-2 space-y-1">
                  {publishIssues.slice(0, 8).map((issue, index) => {
                    const hasTarget = issue.section === "questions" && issue.target?.questionId;
                    return (
                      <li key={`${issue.section}-${index}`}>
                        <button
                          type="button"
                          onClick={() => {
                            if (issue.section === "fields") {
                              setActiveTab("Fields");
                            } else if (hasTarget) {
                              setActiveTab("Questions");
                              setExternalFocus({ id: `${issue.target!.questionId}-${index}`, target: issue.target! });
                            }
                          }}
                          className="group flex items-baseline gap-2 text-left text-sm text-amber-900/75 hover:text-amber-950"
                        >
                          <span className="shrink-0 rounded bg-amber-200/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-900 group-hover:bg-amber-300/60">
                            {issue.label}
                          </span>
                          <span className={hasTarget ? "underline-offset-2 group-hover:underline" : ""}>{issue.message}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {publishIssues.length > 8 && (
                  <p className="mt-2 text-xs text-amber-900/60">
                    {publishIssues.length - 8} more issue{publishIssues.length - 8 === 1 ? "" : "s"} remaining.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPublishIssues([])}
                className="shrink-0 text-xs font-medium text-amber-900/60 hover:text-amber-950"
              >
                Dismiss
              </button>
            </div>
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
                tab === "Variables" ? variables.length :
                0;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    if (tab === activeTab) return;
                    if (activeTab === "Fields" && fields.some(f => !f.label.trim())) {
                      const lastValid = lastValidFieldsRef.current;
                      const validIds = new Set(lastValid.map(f => f.id));
                      setFields(fields
                        .filter(f => f.label.trim() || validIds.has(f.id))
                        .map(f => !f.label.trim() ? (lastValid.find(s => s.id === f.id) ?? f) : f)
                      );
                    }
                    if (activeTab === "Variables" && variables.some(v => !v.label.trim())) {
                      const lastValid = lastValidVariablesRef.current;
                      const validIds = new Set(lastValid.map(v => v.id));
                      setVariables(variables
                        .filter(v => v.label.trim() || validIds.has(v.id))
                        .map(v => !v.label.trim() ? (lastValid.find(s => s.id === v.id) ?? v) : v)
                      );
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
                  className="min-h-[560px] w-full resize-none overflow-y-auto rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-3 text-sm text-foreground placeholder:text-foreground/70 focus:border-teal-700/60 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                />
              </div>
            )}

            {/* ── Fields Tab ── */}
            {activeTab === "Fields" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground/80">Data schema</h3>
                  <p className="text-xs text-foreground/60">
                    Define fields to store applicant answers (used by questions and reject branches).
                  </p>
                </div>

                <LandlordFieldsSection
                  fields={fields}
                  onChange={handleFieldsChange}
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
                  aiInstructions={aiInstructions}
                  onChange={setQuestions}
                  onGenerateTargeted={handleGenerateTargeted}
                  externalFocus={externalFocus}
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
                <VariablesSection
                  variables={variables}
                  onChange={handleVariablesChange}
                  questionTexts={getAllQuestionTexts(questions)}
                  onBeforeDelete={(index) => {
                    requestDeleteVariable(index);
                    return false;
                  }}
                />
              </div>
            )}

            {/* ── Rules Tab ── */}
            {activeTab === "Rules" && (
              <div className="space-y-6">
                <RulesSummary
                  questions={questions}
                  fields={fields}
                  variables={variables}
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
                  <div>
                    <h3 className="text-sm font-medium text-foreground/80">Opening greeting</h3>
                    <p className="mt-0.5 text-[11px] text-foreground/55">Instructions for how the AI should open the conversation. Leave blank to use the default.</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">When the applicant&apos;s name is known</label>
                    <p className="text-[11px] text-foreground/55">The URL will contain <code className="font-mono text-[10px]">?name=…</code>. Use <code className="font-mono text-[10px]">{"{name}"}</code> to include it.</p>
                    <textarea
                      rows={2}
                      value={aiInstructions.greetingWithName}
                      onChange={(e) => setAiInstructions((prev) => ({ ...prev, greetingWithName: e.target.value }))}
                      placeholder={`e.g. Greet {name} warmly by name, briefly introduce yourself, and ask about their move-in date.`}
                      className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:border-teal-700/60 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">When the applicant&apos;s name is unknown</label>
                    <textarea
                      rows={2}
                      value={aiInstructions.greetingWithoutName}
                      onChange={(e) => setAiInstructions((prev) => ({ ...prev, greetingWithoutName: e.target.value }))}
                      placeholder="e.g. Very briefly introduce yourself and ask for the applicant's name first."
                      className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:border-teal-700/60 focus:outline-none"
                    />
                  </div>
                </div>

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

            {/* ── Test Tab ── */}
            {activeTab === "Test" && (
              <div className="space-y-6">
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-foreground/60">
                    Describe an applicant scenario and AI will simulate the full screening conversation, extract answers, and evaluate your question branches — so you can verify your setup before sharing.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-foreground/60">Scenario</label>
                  <textarea
                    rows={3}
                    value={testScenario}
                    onChange={(e) => { setTestScenario(e.target.value); setTestResult(null); setTestSaved(false); }}
                    placeholder="e.g. A well-qualified applicant — income $9,000/mo, no pets, moving in June 1, currently employed full-time"
                    className="w-full resize-none rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2.5 text-sm placeholder:text-foreground/35 focus:border-teal-700/40 focus:bg-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleRunTest()}
                    disabled={!testScenario.trim() || testLoading || fields.length === 0}
                    className="self-start rounded-lg bg-teal-800 px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {testLoading ? "Generating…" : "Run test"}
                  </button>
                  {fields.length === 0 && (
                    <p className="text-xs text-foreground/40">Add fields to your property before running a test.</p>
                  )}
                </div>

                {testResult && (
                  <div className="flex flex-col gap-5 border-t border-foreground/8 pt-5">
                    {/* Outcome */}
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground/60">Outcome:</span>
                      {testResult.outcome === "qualified"   && <span className="rounded-full bg-teal-100 px-3 py-1 text-sm font-semibold text-teal-800">Qualified</span>}
                      {testResult.outcome === "rejected"    && <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">Rejected</span>}
                      {testResult.outcome === "review"      && <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-700">Review</span>}
                      {testResult.outcome === "in_progress" && <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-semibold text-zinc-500">Incomplete</span>}
                      {testResult.violations.filter(Boolean).length > 0 && (
                        <span className="text-xs text-red-600">{testResult.violations.filter(Boolean)[0]}</span>
                      )}
                    </div>

                    {/* Extracted answers */}
                    {Object.keys(testResult.answers).length > 0 && (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-foreground/40">Extracted answers</p>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                          {Object.entries(testResult.answers).map(([k, v]) => {
                            const f = fields.find((x) => x.id === k);
                            return (
                              <div key={k} className="flex items-baseline gap-2 text-sm">
                                <span className="shrink-0 text-foreground/50">{f?.label ?? k}:</span>
                                <span className="truncate font-medium text-foreground/80">{v}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Conversation */}
                    {testResult.messages.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-foreground/40">Simulated conversation</p>
                        <div className="flex flex-col gap-2 rounded-xl border border-foreground/8 bg-[#f7f9f8] p-4 max-h-96 overflow-y-auto">
                          {testResult.messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                              <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                                m.role === "user"
                                  ? "bg-teal-800 text-white"
                                  : "bg-white border border-foreground/8 text-foreground/80"
                              }`}>
                                {m.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Save */}
                    <button
                      type="button"
                      onClick={() => void handleSaveTest()}
                      disabled={testSaved}
                      className="self-start rounded-lg border border-foreground/10 px-4 py-2 text-sm text-foreground/60 transition-colors hover:bg-[#f7f9f8] disabled:opacity-40"
                    >
                      {testSaved ? "Saved to Applicants ✓" : "Save test session"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Global Floating AI button */}
        <div className="fixed bottom-8 right-8 z-50">
          {questionsAiOpen ? (
            <div className="flex w-80 flex-col gap-2 rounded-xl border border-teal-700/20 bg-white p-3 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground/60">
                  {clarifyingQuestions.length > 0 ? "A few quick questions" : "Generate with AI"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setQuestionsAiOpen(false);
                    setQuestionsPrompt("");
                    setClarifyingQuestions([]);
                    setClarifyingAnswers([]);
                  }}
                  aria-label="Close"
                  className="rounded p-0.5 text-foreground/40 hover:text-foreground/70"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {clarifyingQuestions.length > 0 ? (
                <>
                  <div className="rounded-md border border-foreground/8 bg-foreground/[0.02] px-2 py-1.5 text-xs text-foreground/55 whitespace-pre-wrap">
                    {questionsPrompt}
                  </div>
                  <div className="flex flex-col gap-2">
                    {clarifyingQuestions.map((q, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-foreground/75">{q}</label>
                        <textarea
                          rows={2}
                          value={clarifyingAnswers[i] ?? ""}
                          onChange={(e) => {
                            const next = [...clarifyingAnswers];
                            next[i] = e.target.value;
                            setClarifyingAnswers(next);
                          }}
                          placeholder="(optional)"
                          className="resize-none rounded-md border border-foreground/10 bg-white px-2 py-1 text-xs text-foreground placeholder:text-foreground/40 focus:border-teal-700/60 focus:outline-none focus:ring-1 focus:ring-teal-700/20"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => { setClarifyingQuestions([]); setClarifyingAnswers([]); }}
                      disabled={loadingPhase !== null}
                      className="text-xs text-foreground/55 hover:text-foreground/80 disabled:opacity-50"
                    >
                      ← Edit prompt
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void submitClarifications(true)}
                        disabled={loadingPhase !== null}
                        className="text-xs text-foreground/55 hover:text-foreground/80 disabled:opacity-50"
                      >
                        Skip
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitClarifications(false)}
                        disabled={loadingPhase !== null}
                        className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-teal-800 disabled:opacity-60"
                      >
                        {loadingPhase === "questions" ? "Generating…" : "Generate"}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {!questionsPrompt && (
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {[
                        "Add a standard pet policy",
                        "Require 3x income and no evictions",
                        "Make it student housing friendly",
                      ].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setQuestionsPrompt(t)}
                          className="rounded-full border border-teal-700/20 bg-teal-50/50 px-2.5 py-1 text-[10px] font-medium text-teal-800 transition-colors hover:bg-teal-100/50"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                  <QuestionMentionTextarea
                    rows={4}
                    value={questionsPrompt}
                    onChange={setQuestionsPrompt}
                    questions={questions}
                    onKeyDown={(e) => { if (e.key === "Escape") { setQuestionsAiOpen(false); setQuestionsPrompt(""); } }}
                    placeholder="e.g. Ask about number of occupants, pets, and income. Reject smokers."
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
                        onClick={() => void handleGenerateQuestions(questionsPrompt)}
                        disabled={!questionsPrompt.trim() || loadingPhase !== null || isRecording || isTranscribing}
                        className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-teal-800 disabled:opacity-60"
                      >
                        {loadingPhase === "questions" ? "Thinking…" : "Generate with AI"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setClarifyingQuestions([]);
                setClarifyingAnswers([]);
                setQuestionsAiOpen(true);
              }}
              aria-label="Generate with AI"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg transition-transform hover:scale-105 hover:bg-teal-800"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" fill="currentColor" />
              </svg>
            </button>
          )}
        </div>

      </div>
      <RuleProposalModal
        open={!!ruleProposal}
        proposal={ruleProposal}
        existingQuestions={questions}
        existingFields={fields}
        existingVariables={variables}
        onConfirm={applyProposal}
        onCancel={() => setRuleProposal(null)}
      />

      <DeleteFieldDialog
        open={fieldDeleteIndex !== null}
        field={fieldDeleteIndex !== null ? (fields[fieldDeleteIndex] ?? null) : null}
        referencedQuestions={
          fieldDeleteIndex !== null
            ? questions.filter((q) => q.fieldIds.includes(fields[fieldDeleteIndex]?.id ?? ""))
            : []
        }
        variables={variables}
        onConfirm={() => confirmDeleteField()}
        onCancel={() => setFieldDeleteIndex(null)}
      />

      <DeleteVariableDialog
        open={varDeleteIndex !== null}
        variable={varDeleteIndex !== null ? (variables[varDeleteIndex] ?? null) : null}
        referencedQuestions={
          varDeleteIndex !== null
            ? getQuestionsWithVarInText(`{{${variables[varDeleteIndex]?.id ?? ""}}}`)
            : []
        }
        conditionReferencedQuestions={
          varDeleteIndex !== null
            ? getQuestionsWithVarInCondition(`{{${variables[varDeleteIndex]?.id ?? ""}}}`)
            : []
        }
        variables={variables}
        fields={fields}
        onConfirm={() => confirmDeleteVariable()}
        onCancel={() => setVarDeleteIndex(null)}
      />
      {renameModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-black/8 bg-white p-0 shadow-xl">
            <form onSubmit={handleRenameSubmit} className="p-6">
              <h3 className="text-sm font-semibold text-[#1a2e2a]">Rename Property</h3>
              <p className="mt-2 text-sm text-[#1a2e2a]/60">
                Enter a new internal name for this property. Your active share link will remain unchanged.
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
