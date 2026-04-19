/**
 * Depth-based color theming shared by the question editor and the AI
 * proposal modal so both views feel like one product. Each depth level gets
 * a single hue applied to the path label and the vertical guide line —
 * card backgrounds stay neutral white to keep the screen quiet.
 *
 * Tailwind needs full literal class names so we enumerate them.
 */
export const DEPTH_PALETTE = [
  // Depth 0 (root) — teal (brand)
  {
    name: "teal",
    label: "text-teal-700",
    guide: "border-teal-400/60",
    accent: "text-teal-700",
    badgeBg: "bg-teal-100",
    badgeText: "text-teal-800",
  },
  // Depth 1 — indigo
  {
    name: "indigo",
    label: "text-indigo-700",
    guide: "border-indigo-400/60",
    accent: "text-indigo-700",
    badgeBg: "bg-indigo-100",
    badgeText: "text-indigo-800",
  },
  // Depth 2 — purple
  {
    name: "purple",
    label: "text-purple-700",
    guide: "border-purple-400/60",
    accent: "text-purple-700",
    badgeBg: "bg-purple-100",
    badgeText: "text-purple-800",
  },
  // Depth 3+ — pink
  {
    name: "pink",
    label: "text-pink-700",
    guide: "border-pink-400/60",
    accent: "text-pink-700",
    badgeBg: "bg-pink-100",
    badgeText: "text-pink-800",
  },
] as const;

export type DepthStyle = (typeof DEPTH_PALETTE)[number];

export function depthStyle(depth: number): DepthStyle {
  return DEPTH_PALETTE[Math.min(Math.max(depth, 0), DEPTH_PALETTE.length - 1)];
}
