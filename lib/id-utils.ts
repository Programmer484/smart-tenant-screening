export function generateId(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function labelToId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40);
}
