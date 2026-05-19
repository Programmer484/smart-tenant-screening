export type BranchCondition = {
  fieldId: string;
  operator: string;
  value: string;
};

export type BranchOutcome = "continue" | "followups" | "reject";

export type Branch = {
  id: string;
  condition: BranchCondition;
  outcome: BranchOutcome;
  subQuestions: Question[];
  customMessage?: string;
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
  branches: Branch[];
  /** If true, walkTree treats this question's fields as unanswered until it has been explicitly asked, even if those fields were captured by an earlier question. */
  recapture?: boolean;
};
