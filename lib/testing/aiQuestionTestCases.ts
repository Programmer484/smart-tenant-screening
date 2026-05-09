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
      "Must have a 'too early' branch using the expression {{availability_date}} - 30 (not a hardcoded date)",
      "The 'too early' branch must ask a follow-up question to see if the applicant can wait",
      "Must have a 'too late' branch using the expression {{availability_date}} + 30 (not a hardcoded date)",
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
    id: "multi_occupant_flat_schema",
    name: "Conditional Family Rules and Multi-Occupant Flat Fields",
    description: "Tests generation of flat fields for multiple occupants and conditional child age questions.",
    prompt: "I only want to rent to families with a child who is between {{min_child_age}} and {{max_child_age}} years old. Don't ask about kids' ages unless they actually say they have a child. Also, I need to know the relationship between all the people moving in, and I need the name and job for up to {{max_occupants}} occupants.",
    variables: {
      min_child_age: "8",
      max_child_age: "15",
      max_occupants: "3"
    },
    requirements: [
      "Must collect a boolean field asking if the applicant has children",
      "Must have a conditional branch that triggers ONLY if they have children",
      "The child branch must collect a number field for the child's age",
      "Must generate rejection branches to reject applicants who do not have children, or whose child is under 8, or whose child is over 15",
      "Must generate separate, distinct text fields for the names and jobs of exactly 3 occupants (occupant_1_name, occupant_1_job, etc.)",
      "Must ask a question collecting the relationship between the occupants",
      "Must NOT use nested arrays or object data structures for occupants"
    ],
    mockOutput: {
      newFields: [
        { id: "has_children", label: "Do you have any children?", value_kind: "boolean" },
        { id: "child_age", label: "What is the child's age?", value_kind: "number" },
        { id: "occupants_relationship", label: "What is the relationship between all occupants?", value_kind: "text" },
        { id: "occupant_1_name", label: "Occupant 1 Name", value_kind: "text" },
        { id: "occupant_1_job", label: "Occupant 1 Occupation", value_kind: "text" },
        { id: "occupant_2_name", label: "Occupant 2 Name", value_kind: "text" },
        { id: "occupant_2_job", label: "Occupant 2 Occupation", value_kind: "text" },
        { id: "occupant_3_name", label: "Occupant 3 Name", value_kind: "text" },
        { id: "occupant_3_job", label: "Occupant 3 Occupation", value_kind: "text" }
      ],
      questions: [
        {
          id: "q_children",
          text: "Do you have any children moving in with you?",
          fieldIds: ["has_children"],
          sort_order: 0,
          branches: [
            {
              id: "b_no_children",
              condition: { fieldId: "has_children", operator: "==", value: "false" },
              outcome: "reject",
              subQuestions: []
            },
            {
              id: "b_has_children",
              condition: { fieldId: "has_children", operator: "==", value: "true" },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_child_age",
                  text: "How old is your child?",
                  fieldIds: ["child_age"],
                  sort_order: 0,
                  branches: [
                    {
                      id: "b_child_too_young",
                      condition: { fieldId: "child_age", operator: "<", value: "8" },
                      outcome: "reject",
                      subQuestions: []
                    },
                    {
                      id: "b_child_too_old",
                      condition: { fieldId: "child_age", operator: ">", value: "15" },
                      outcome: "reject",
                      subQuestions: []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          id: "q_occupants_info",
          text: "Please provide the names and occupations of up to 3 people who will be living in the unit, and describe your relationship.",
          fieldIds: [
            "occupants_relationship",
            "occupant_1_name", "occupant_1_job",
            "occupant_2_name", "occupant_2_job",
            "occupant_3_name", "occupant_3_job"
          ],
          sort_order: 1,
          branches: []
        }
      ],
      deletedQuestionIds: []
    }
  }
];
