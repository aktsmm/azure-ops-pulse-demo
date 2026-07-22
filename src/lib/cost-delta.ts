export function describeCostDelta(deltaPercent: number): {
  label: "Increased" | "Decreased" | "Unchanged";
  direction: "up" | "down" | "flat";
} {
  if (deltaPercent > 0) return { label: "Increased", direction: "up" };
  if (deltaPercent < 0) return { label: "Decreased", direction: "down" };
  return { label: "Unchanged", direction: "flat" };
}
