import type { PageObservation } from "@/agent/types";

const STOP = new Set([
  "research",
  "find",
  "verify",
  "give",
  "compare",
  "their",
  "from",
  "sites",
  "and",
  "the",
  "for",
  "with",
  "that",
  "this",
  "please",
  "into",
  "openings",
  "engineering",
  "website",
  "product",
  "target",
  "customer",
  "pricing",
  "funding",
  "jobs",
  "each",
  "them",
  "about",
  "using",
  "across",
  "compile",
  "table",
  "brief",
]);

const TOPIC = [
  "ai",
  "artificial",
  "intelligence",
  "accounting",
  "bookkeeping",
  "bookkeep",
  "invoicing",
  "ledger",
  "startup",
  "startups",
  "software",
  "saas",
  "fintech",
  "automation",
];

export function searchUrl(query: string, engine: "wiki" | "ddg" = "wiki"): string {
  const q = encodeURIComponent(query.trim());
  if (engine === "ddg") {
    return `https://html.duckduckgo.com/html/?q=${q}`;
  }
  return `https://en.wikipedia.org/w/index.php?search=${q}`;
}

export function searchQueryFromGoal(goal: string): string {
  const words = goal
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP.has(word) && !/^\d+$/.test(word));

  const topicHits = words.filter((word) => TOPIC.includes(word));
  const extra = words.filter((word) => !TOPIC.includes(word)).slice(0, 3);
  const query = [...new Set([...topicHits, ...extra])].join(" ").trim();
  return query || "AI accounting software";
}

export function topicKeywords(goal: string): string[] {
  return searchQueryFromGoal(goal)
    .split(/\s+/)
    .filter(Boolean);
}

export function isWikipediaSearchPage(observation: PageObservation): boolean {
  const url = observation.url.toLowerCase();
  return (
    url.includes("wikipedia.org") &&
    (url.includes("index.php?search") ||
      url.includes("special:search") ||
      /search results/i.test(observation.title))
  );
}

export function isMissingWikipediaArticle(observation: PageObservation): boolean {
  const text = `${observation.title} ${observation.excerpt}`.toLowerCase();
  return (
    observation.url.includes("wikipedia.org") &&
    (text.includes("does not exist") || text.includes("wikipedia does not have an article"))
  );
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
