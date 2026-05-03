import type { LandlordField } from "@/lib/landlord-field";
import type { Question } from "@/lib/question";
import type { LandlordRule } from "@/lib/landlord-rule";

export type AIQuestionOutput = {
  newFields?: LandlordField[];
  questions?: Question[];
  deletedQuestionIds?: string[];
  
  // Rule generation fields (optional, if we want to support both)
  newRules?: LandlordRule[];
  modifiedRules?: LandlordRule[];
  deletedRuleIds?: string[];
};

export type TestCase = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  variables?: Record<string, string>;
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
    id: "move_in_grace_period",
    name: "Move-in Date with Grace Period and Negotiation",
    description: "Tests conditional branches around a target move-in date with grace periods.",
    prompt: "The unit is available on {{availability_date}}. If they want to move in before the availability date, ask if they can wait. If they want to move in after but within {{grace_period_days}} days, that's fine. If it's more than {{grace_period_days}} days after, ask if they can move in sooner.",
    variables: {
      availability_date: "2024-09-01",
      grace_period_days: "15",
      max_acceptable_date: "2024-09-15" // Just for reference
    },
    requirements: [
      "Must collect a date field for desired_move_in_date",
      "Must have a condition branching on desired_move_in_date < 2024-09-01",
      "The 'before Sept 1' branch must ask a follow-up question seeing if they can wait",
      "Must have a condition branching on desired_move_in_date > 2024-09-15",
      "The 'after Sept 15' branch must ask a follow-up question seeing if they can move in sooner",
      "Must NOT have any rejection or follow-up branches for dates between Sept 1st and Sept 15th"
    ],
    mockOutput: {
      newFields: [
        {
          id: "desired_move_in_date",
          label: "When would you like to move in?",
          value_kind: "date",
        },
        {
          id: "can_wait_until_available",
          label: "Can you wait until the unit is available on Sept 1st?",
          value_kind: "boolean",
        },
        {
          id: "can_move_sooner",
          label: "Can you move in sooner (by Sept 15th)?",
          value_kind: "boolean",
        }
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
              condition: {
                fieldId: "desired_move_in_date",
                operator: "<",
                value: "2024-09-01"
              },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_can_wait",
                  text: "The unit is not available until September 1st. Are you able to wait until then?",
                  fieldIds: ["can_wait_until_available"],
                  sort_order: 0,
                  branches: []
                }
              ]
            },
            {
              id: "b_too_late",
              condition: {
                fieldId: "desired_move_in_date",
                operator: ">",
                value: "2024-09-15"
              },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_can_move_sooner",
                  text: "That date is a bit far out. Would you be able to move in by September 15th?",
                  fieldIds: ["can_move_sooner"],
                  sort_order: 0,
                  branches: []
                }
              ]
            }
          ]
        }
      ],
      deletedQuestionIds: []
    }
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
              id: "b_has_children",
              condition: { fieldId: "has_children", operator: "==", value: "true" },
              outcome: "followups",
              subQuestions: [
                {
                  id: "q_child_age",
                  text: "How old is your child?",
                  fieldIds: ["child_age"],
                  sort_order: 0,
                  branches: []
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
      newRules: [
        {
          id: "rule_require_children",
          kind: "reject",
          conditions: [
            { id: "cond_no_kids", fieldId: "has_children", operator: "==", value: "false" }
          ]
        },
        {
          id: "rule_child_too_young",
          kind: "reject",
          conditions: [
            { id: "cond_age_young", fieldId: "child_age", operator: "<", value: "8" }
          ]
        },
        {
          id: "rule_child_too_old",
          kind: "reject",
          conditions: [
            { id: "cond_age_old", fieldId: "child_age", operator: ">", value: "15" }
          ]
        }
      ],
      deletedQuestionIds: []
    }
  }
];
