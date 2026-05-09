import type { LandlordField } from "@/lib/landlord-field";
import type { Question } from "@/lib/question";
import type { LandlordRule } from "@/lib/landlord-rule";
import type { PropertyVariable } from "@/lib/property";

export type AIQuestionOutput = {
  newFields?: LandlordField[];
  questions?: Question[];
  deletedQuestionIds?: string[];

  // Rule generation fields (optional, if we want to support both)
  newRules?: LandlordRule[];
  modifiedRules?: LandlordRule[];
  deletedRuleIds?: string[];
  
  prompts?: {
    system?: string;
    user?: string;
  };
};

export type TestCase = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  /** Simple key→value substitution applied to the prompt text before sending to the AI */
  variables?: Record<string, string>;
  /** Full PropertyVariable objects passed to the generator so the AI can use {{key}} expressions in conditions */
  propertyVariables?: PropertyVariable[];
  existingFields?: Pick<LandlordField, "id" | "label" | "value_kind">[];
  existingQuestions?: { id: string; text: string; fieldIds: string[] }[];
  requirements: string[];
  mockOutput: AIQuestionOutput;
};

export const testCases: TestCase[] = [
  {
    id: "create_scratch_pet",
    name: "Create From Scratch - Pet Question",
    description: "Generates a brand new question and branch about pets",
    prompt: "I want to know if they have pets. If they do, ask what kind and how many.",
    requirements: [
      "Must collect a boolean field for has_pets",
      "Must have a question asking about pets",
      "Must have a conditional branch that triggers when has_pets is true",
      "The branch must contain follow-up questions for pet_type and pet_count",
    ],
    mockOutput: {
      newFields: [
        {
          id: "has_pets",
          label: "Do you have any pets?",
          value_kind: "boolean",
        },
        {
          id: "pet_type",
          label: "What type of pet(s)?",
          value_kind: "text",
        },
        {
          id: "pet_count",
          label: "How many pets?",
          value_kind: "number",
        },
      ],
      questions: [
        {
          id: "q_pets",
          text: "Do you have any pets?",
          fieldIds: ["has_pets"],
          sort_order: 0,
          branches: [
            {
              id: "b_pets_yes",
              condition: {
                fieldId: "has_pets",
                operator: "==",
                value: "true",
              },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_pet_details",
                  text: "Please tell us the type and number of pets.",
                  fieldIds: ["pet_type", "pet_count"],
                  sort_order: 0,
                  branches: [],
                },
              ],
            },
          ],
        },
      ],
      deletedQuestionIds: [],
    },
  },
  {
    id: "branching_income_proof",
    name: "Conditional Question - Income Proof",
    description: "Generates a conditional requirement based on an existing question",
    prompt: "If their income is less than 3000, ask for a co-signer.",
    requirements: [
      "Must use a condition where income is less than 3000",
      "Must add a field for co-signer details",
      "Must ask a follow-up question about the co-signer",
    ],
    mockOutput: {
      newFields: [
        {
          id: "cosigner_name",
          label: "Co-signer Name",
          value_kind: "text",
        },
      ],
      questions: [
        {
          id: "q_income",
          text: "What is your monthly income?",
          fieldIds: ["monthly_income"], // Assuming this exists or is implicitly used
          sort_order: 0,
          branches: [
            {
              id: "b_income_low",
              condition: {
                fieldId: "monthly_income",
                operator: "<",
                value: "3000",
              },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_cosigner",
                  text: "Since your income is below $3000, please provide a co-signer.",
                  fieldIds: ["cosigner_name"],
                  sort_order: 0,
                  branches: [],
                },
              ],
            },
          ],
        },
      ],
      deletedQuestionIds: [],
    },
  },
  {
    id: "modify_smoking",
    name: "Modify Existing Question - Smoking",
    description: "Modifies an existing question to ask for more details",
    prompt: "Change the smoking question to also ask if they smoke indoors or outdoors.",
    existingFields: [
      { id: "smokes", label: "Do you smoke?", value_kind: "boolean" },
    ],
    existingQuestions: [
      { id: "q_smoking", text: "Do you smoke?", fieldIds: ["smokes"] },
    ],
    requirements: [
      "Must add a field for smoking location (indoors/outdoors)",
      "Must update the existing smoking question (q_smoking) to include the new field",
      "Must not delete the original question ID unless replacing it",
    ],
    mockOutput: {
      newFields: [
        {
          id: "smoking_location",
          label: "Smoking Location",
          value_kind: "enum",
          options: ["Indoors", "Outdoors"],
        },
      ],
      questions: [
        {
          id: "q_smoking", // Modifying existing
          text: "Do you smoke? If so, do you smoke indoors or outdoors?",
          fieldIds: ["smokes", "smoking_location"],
          sort_order: 0,
          branches: [],
        },
      ],
      deletedQuestionIds: [],
    },
  },
  {
    id: "availability_window",
    name: "Move-in Date Availability Window (±30 days, expression-based)",
    description: "Tests that the AI uses variable expressions ({{availability_date}} ± 30) instead of hardcoded dates for the move-in window branches.",
    prompt: "The unit is available on {{availability_date}}. We're flexible — applicants can move in up to 30 days before or after that date. If they want to move in more than 30 days before, ask if they can wait. If more than 30 days after, ask if they can move in sooner.",
    propertyVariables: [
      { id: "v_avail", key: "availability_date", label: "Availability Date", value: "2024-09-01", value_kind: "date" },
    ],
    requirements: [
      "Must collect a date field for desired_move_in_date",
      "Must have a 'too early' branch with operator < (less than / is before) and condition value {{availability_date}} - 30 — not a hardcoded date",
      "The 'too early' branch must ask a follow-up question to see if the applicant can wait",
      "Must have a 'too late' branch with operator > (greater than / is after) and condition value {{availability_date}} + 30 — not a hardcoded date",
      "The 'too late' branch must ask a follow-up question to see if the applicant can move in sooner",
      "Must NOT add any branch or rejection for dates within the ±30-day window",
    ],
    mockOutput: {
      newFields: [
        { id: "desired_move_in_date", label: "Desired Move-in Date", value_kind: "date" },
        { id: "can_wait_until_window", label: "Can you wait until closer to the availability date?", value_kind: "boolean" },
        { id: "can_move_sooner", label: "Can you move in sooner?", value_kind: "boolean" },
      ],
      questions: [
        {
          id: "q_move_in_date",
          text: "What is your desired move-in date?",
          fieldIds: ["desired_move_in_date"],
          sort_order: 0,
          branches: [
            {
              id: "b_too_early",
              condition: { fieldId: "desired_move_in_date", operator: "<", value: "{{availability_date}} - 30" },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_can_wait",
                  text: "That date is more than 30 days before the unit is available. Would you be able to wait until closer to {{availability_date}}?",
                  fieldIds: ["can_wait_until_window"],
                  sort_order: 0,
                  branches: [],
                },
              ],
            },
            {
              id: "b_too_late",
              condition: { fieldId: "desired_move_in_date", operator: ">", value: "{{availability_date}} + 30" },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_can_move_sooner",
                  text: "That date is more than 30 days after the unit becomes available. Would you be able to move in sooner?",
                  fieldIds: ["can_move_sooner"],
                  sort_order: 0,
                  branches: [],
                },
              ],
            },
          ],
        },
      ],
      deletedQuestionIds: [],
    },
  },
  {
    id: "boolean_not_equals",
    name: "Boolean != Operator — Missing Landlord Reference",
    description: "Tests that the AI can branch on a boolean field being false using either == false or != true",
    prompt: "Ask if they have a landlord reference. If they don't have one, ask why.",
    requirements: [
      "Must collect a boolean field for whether they have a landlord reference",
      "Must have a branch that triggers when that field is false — using either operator == with value false, or operator != with value true",
      "The branch outcome must be followups (not reject)",
      "The follow-up must ask the applicant to explain why they don't have a reference",
    ],
    mockOutput: {
      newFields: [
        { id: "has_landlord_reference", label: "Do you have a landlord reference?", value_kind: "boolean" },
        { id: "no_reference_reason", label: "Why don't you have a landlord reference?", value_kind: "text" },
      ],
      questions: [
        {
          id: "q_reference",
          text: "Do you have a landlord reference available?",
          fieldIds: ["has_landlord_reference"],
          sort_order: 0,
          branches: [
            {
              id: "b_no_reference",
              condition: { fieldId: "has_landlord_reference", operator: "!=", value: "true" },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_no_reference_reason",
                  text: "Could you explain why you don't have a landlord reference?",
                  fieldIds: ["no_reference_reason"],
                  sort_order: 0,
                  branches: [],
                },
              ],
            },
          ],
        },
      ],
      deletedQuestionIds: [],
    },
  },
  {
    id: "multi_occupant_flat_schema",
    name: "Occupant Relationships + Family-of-3 Child Age Check",
    description: "Occupant 1 is always the applicant. Collect the number of occupants and each additional occupant's relationship to the applicant in one question. Up to 2 occupants are always accepted. 3 occupants only accepted if one has a child relationship aged 8–15; child presence is inferred from the relationship field, not asked directly.",
    prompt: "I accept up to 2 people normally. If there are 3, it's only okay if one of the extra occupants is a child between 8 and 15 — otherwise reject. More than 3 is always rejected. Occupant 1 is always the person filling out the form, so I need the relationship of the form filler to occupant 2 and occupant 3. Collect the occupant count and both relationships in the same question before moving on. Do NOT ask a separate yes/no question about whether they have a child — infer it from the relationship field.",
    requirements: [
      "Occupant 1 is the applicant — must NOT create a relationship field for occupant 1",
      "Must collect a number field for total occupant count (including the applicant)",
      "Must collect occupant_2_relationship as an enum field — relationship of the applicant to the second person",
      "Must collect occupant_3_relationship as an enum field — relationship of the applicant to the third person",
      "The occupant count, occupant_2_relationship, and occupant_3_relationship must all be linked to the same question (same fieldIds array)",
      "The relationship enum options must include 'Child' (or equivalent) as one of the options",
      "Must reject if total occupants > 3",
      "Must NOT reject or add any follow-ups when total occupants <= 2",
      "When 3 occupants, must branch on occupant_2_relationship == 'Child' (or equivalent) with outcome followups, leading to a child age question",
      "When 3 occupants, must branch on occupant_3_relationship == 'Child' (or equivalent) with outcome followups, leading to a child age question",
      "Must NOT use a separate boolean field to ask if they have a child — child status must be inferred from the relationship field",
      "Must reject if child age < 8",
      "Must reject if child age > 15",
    ],
    mockOutput: {
      newFields: [
        { id: "num_occupants", label: "How many people will be moving in (including yourself)?", value_kind: "number" },
        {
          id: "occupant_2_relationship",
          label: "What is your relationship to the second occupant?",
          value_kind: "enum",
          options: ["Spouse/Partner", "Child", "Sibling", "Parent", "Friend", "Other"],
        },
        {
          id: "occupant_3_relationship",
          label: "What is your relationship to the third occupant?",
          value_kind: "enum",
          options: ["Spouse/Partner", "Child", "Sibling", "Parent", "Friend", "Other"],
        },
        { id: "child_age", label: "How old is the child?", value_kind: "number" },
      ],
      questions: [
        {
          id: "q_occupants",
          text: "How many people will be moving in (including yourself), and what is your relationship to each of them?",
          fieldIds: ["num_occupants", "occupant_2_relationship", "occupant_3_relationship"],
          sort_order: 0,
          branches: [
            {
              id: "b_too_many",
              condition: { fieldId: "num_occupants", operator: ">", value: "3" },
              outcome: "reject",
              subQuestions: [],
            },
            {
              id: "b_occ2_child",
              condition: { fieldId: "occupant_2_relationship", operator: "==", value: "Child" },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_child_age_occ2",
                  text: "How old is the child?",
                  fieldIds: ["child_age"],
                  sort_order: 0,
                  branches: [
                    {
                      id: "b_occ2_child_too_young",
                      condition: { fieldId: "child_age", operator: "<", value: "8" },
                      outcome: "reject",
                      subQuestions: [],
                    },
                    {
                      id: "b_occ2_child_too_old",
                      condition: { fieldId: "child_age", operator: ">", value: "15" },
                      outcome: "reject",
                      subQuestions: [],
                    },
                  ],
                },
              ],
            },
            {
              id: "b_occ3_child",
              condition: { fieldId: "occupant_3_relationship", operator: "==", value: "Child" },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_child_age_occ3",
                  text: "How old is the child?",
                  fieldIds: ["child_age"],
                  sort_order: 0,
                  branches: [
                    {
                      id: "b_occ3_child_too_young",
                      condition: { fieldId: "child_age", operator: "<", value: "8" },
                      outcome: "reject",
                      subQuestions: [],
                    },
                    {
                      id: "b_occ3_child_too_old",
                      condition: { fieldId: "child_age", operator: ">", value: "15" },
                      outcome: "reject",
                      subQuestions: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      deletedQuestionIds: [],
    },
  }
];
