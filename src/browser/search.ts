import type { PageObservation } from "@/agent/types";

export function searchUrl(query: string, engine: "wiki" | "ddg" = "wiki"): string {
  const q = encodeURIComponent(query.trim());
  if (engine === "ddg") {
    return `https://html.duckduckgo.com/html/?q=${q}`;
  }
  return `https://en.wikipedia.org/w/index.php?search=${q}`;
}

export function queryFromGoal(goal: string): string {
  return goal.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function isBrokenPage(observation: PageObservation): boolean {
  const text = `${observation.title} ${observation.excerpt}`.toLowerCase();
  const url = observation.url.toLowerCase();
  return (
    url.includes("bing.com") ||
    url.includes("duckduckgo.com") ||
    text.includes("unexpected error") ||
    text.includes("if this persists") ||
    text.includes("anonymized error code") ||
    text.includes("enable javascript") ||
    text.includes("access denied") ||
    text.includes("sorry, you have been blocked") ||
    text.includes("please verify you are a human") ||
    text.includes("solve the challenge") ||
    text.includes("one last step") ||
    text.includes("verifying...")
  );
}
