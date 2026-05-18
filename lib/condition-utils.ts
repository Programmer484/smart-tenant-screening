import type { LandlordField } from "@/lib/landlord-field";
import { operatorLabel } from "@/lib/landlord-rule";

export function describeCondition(
  cond: { fieldId: string; operator: string; value: string },
  fields: LandlordField[],
): string {
  const field = fields.find((f) => f.id === cond.fieldId);
  const label = field?.label ?? cond.fieldId ?? "?";
  if (field?.value_kind === "boolean") {
    const isYes = cond.value === "true";
    const expected = cond.operator === "!=" ? !isYes : isYes;
    return `${label} is ${expected ? "Yes" : "No"}`;
  }
  const op = operatorLabel(cond.operator, field?.value_kind);
  return `${label} ${op} ${cond.value || "…"}`;
}
