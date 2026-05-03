export type BranchCondition = {
  fieldId: string;
  operator: string;
  value: string;
};

export type BranchOutcome = "continue" | "followups" | "review" | "reject";

export type Branch = {
  id: string;
  condition: BranchCondition;
  outcome: BranchOutcome;
  subQuestions: Question[];
};

/**
 * Questions are the tenant-facing collection layer.
 * Each question maps to one or more fields (the truth/data layer).
 * Branches route applicants to different outcomes or follow-up questions
 * based on the values they provide.
 */
export type Question = {
  id: string;
  text: string;
  fieldIds: string[];
  sort_order: number;
  extract_hint?: string;
  branches: Branch[];
};
