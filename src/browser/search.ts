import type { PageObservation } from "@/agent/types";

export function searchUrl(query: string, engine: "ddg" | "bing" = "ddg"): string {
  const q = encodeURIComponent(query.trim());
  if (engine === "bing") {
    return `https://www.bing.com/search?q=${q}`;
  }
  return `https://html.duckduckgo.com/html/?q=${q}`;
}

export function queryFromGoal(goal: string): string {
  return goal.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function isBrokenPage(observation: PageObservation): boolean {
  const text = `${observation.title} ${observation.excerpt}`.toLowerCase();
  return (
    text.includes("unexpected error") ||
    text.includes("enable javascript") ||
    text.includes("access denied") ||
    text.includes("sorry, you have been blocked") ||
    text.includes("please verify you are a human")
  );
}
