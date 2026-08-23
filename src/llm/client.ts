import OpenAI from "openai";
import { z } from "zod";
import type { AgentAction, CompanyResearch, PageObservation, PlanStep } from "@/agent/types";

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("navigate"),
    url: z.string(),
    explanation: z.string(),
  }),
  z.object({
    type: z.literal("click"),
    selector: z.string(),
    explanation: z.string(),
  }),
  z.object({
    type: z.literal("fill"),
    selector: z.string(),
    text: z.string(),
    pressEnter: z.boolean().optional(),
    explanation: z.string(),
  }),
  z.object({
    type: z.literal("type"),
    selector: z.string(),
    text: z.string(),
    pressEnter: z.boolean().optional(),
    explanation: z.string(),
  }),
  z.object({
    type: z.literal("scroll"),
    direction: z.enum(["up", "down"]),
    explanation: z.string(),
  }),
  z.object({
    type: z.literal("extract"),
    instruction: z.string(),
    explanation: z.string(),
  }),
  z.object({
    type: z.literal("wait"),
    ms: z.number(),
    explanation: z.string(),
  }),
  z.object({
    type: z.literal("ask_human"),
    reason: z.string(),
    proposedAction: z.string().optional(),
  }),
  z.object({
    type: z.literal("checkpoint"),
    summary: z.string(),
    collected: z.array(z.string()),
    missing: z.array(z.string()),
  }),
  z.object({
    type: z.literal("done"),
    summary: z.string(),
  }),
]);

const planSchema = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
    })
  ),
});

const extractSchema = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      website: z.string().optional(),
      product: z.string().optional(),
      targetCustomer: z.string().optional(),
      pricing: z.string().optional(),
      funding: z.string().optional(),
      engineeringOpenings: z.string().optional(),
      notes: z.string().optional(),
      sourceTitle: z.string().optional(),
      sourceUrl: z.string().optional(),
    })
  ),
  insights: z.string().optional(),
});

export function hasLlmKey() {
  return Boolean(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
}

function getClient() {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    return new OpenAI({
      apiKey: groqKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error(
      "Missing GROQ_API_KEY. Add it to .env, then restart the server."
    );
  }
  return new OpenAI({ apiKey: openaiKey });
}

function getModel() {
  if (process.env.GROQ_API_KEY) {
    return process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  }
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Model did not return valid JSON");
  }
}

async function chatJson<T>(
  system: string,
  user: string,
  schemaHint: string
): Promise<T> {
  const client = getClient();
  const messages = [
    {
      role: "system" as const,
      content: `${system}

Return ONLY a single JSON object. No markdown, no commentary.
Shape:
${schemaHint}`,
    },
    { role: "user" as const, content: user },
  ];

  const attempts: Array<{ jsonMode: boolean }> = process.env.GROQ_API_KEY
    ? [{ jsonMode: false }, { jsonMode: true }]
    : [{ jsonMode: true }, { jsonMode: false }];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const response = await client.chat.completions.create({
        model: getModel(),
        temperature: 0.2,
        ...(attempt.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
        messages,
      });

      const message = response.choices[0]?.message;
      const content =
        message?.content ||
        (typeof (message as { reasoning?: string } | undefined)?.reasoning === "string"
          ? (message as { reasoning?: string }).reasoning
          : "");
      if (!content) throw new Error("Empty LLM response");
      return extractJsonObject(content) as T;
    } catch (error) {
      lastError = error;
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : "LLM request failed";
  throw new Error(message);
}

export async function createPlan(goal: string): Promise<PlanStep[]> {
  const raw = await chatJson<{ steps: { id: string; label: string }[] }>(
    `You are ResearchPilot's planner. Create a concise multi-step research plan for a browser agent.
Keep 5-8 steps. Prefer verifying facts on company websites.`,
    `Goal: ${goal}`,
    `{ "steps": [{ "id": "step-1", "label": "..." }] }`
  );

  const parsed = planSchema.parse(raw);
  return parsed.steps.map((step) => ({
    ...step,
    status: "pending" as const,
  }));
}

export async function decideNextAction(input: {
  goal: string;
  plan: PlanStep[];
  observation: PageObservation | null;
  memory: string;
  companies: CompanyResearch[];
  stepIndex: number;
}): Promise<AgentAction> {
  const planText = input.plan
    .map((s, i) => `${i === input.stepIndex ? "→" : "-"} [${s.status}] ${s.label}`)
    .join("\n");

  const companiesText =
    input.companies.length === 0
      ? "None yet"
      : input.companies
          .map(
            (c) =>
              `- ${c.name}: product=${c.product || "?"} pricing=${c.pricing || "?"} funding=${c.funding || "?"} jobs=${c.engineeringOpenings || "?"}`
          )
          .join("\n");

  const observationText = input.observation
    ? `URL: ${input.observation.url}
Title: ${input.observation.title}
Excerpt: ${input.observation.excerpt}
Interactive elements:
${input.observation.interactiveElements
  .slice(0, 25)
  .map((el) => `- ${el.tag}: "${el.text}" => ${el.selector}`)
  .join("\n")}`
    : "No page loaded yet. Navigate to a Wikipedia search for the user's goal: https://en.wikipedia.org/w/index.php?search=URL_ENCODED_GOAL";

  const raw = await chatJson<AgentAction>(
    `You are ResearchPilot, an autonomous browser research agent.
Choose ONE next action to progress the goal.

Stay on-topic for the user's goal (for accounting/AI research: accounting software, bookkeeping, invoicing — never conglomerates like SoftBank unless the goal names them).
If you are on Wikipedia search results, click a result whose title matches the topic, then EXTRACT, then open the Official website link in the infobox.
Never use Bing, Google, or DuckDuckGo — they block automated browsers.
Never invent a company list from memory. Only extract names that appear on the current page.
If a Wikipedia article does not exist, click a listed search result that matches the topic.

Use company websites to verify product, pricing, customers, and careers. Click pricing/careers/about when those links exist.
Use extract when the current page itself contains company facts.
Use done only after extracting from real pages you opened. If you have nothing verified, still call done rather than inventing rows.
Explanations must be short, user-facing decision notes — never private chain-of-thought.`,
    `Goal: ${input.goal}

Plan:
${planText}

Collected companies:
${companiesText}

Working memory:
${input.memory || "None"}

Current observation:
${observationText}`,
    `{ "type": "navigate|click|fill|type|scroll|extract|wait|ask_human|checkpoint|done", ...fields, "explanation": "..." }`
  );

  const parsed = actionSchema.safeParse(coerceAction(raw));
  if (parsed.success) return parsed.data;
  throw new Error("Model returned an action that did not match the expected format");
}

function coerceAction(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  let obj = { ...(raw as Record<string, unknown>) };
  if (obj.action && typeof obj.action === "object") {
    obj = {
      ...(obj.action as Record<string, unknown>),
      explanation: obj.explanation || (obj.action as Record<string, unknown>).explanation,
    };
  }
  if (!obj.explanation) obj.explanation = "Continue research";
  if (obj.type === "goto" || obj.type === "search") {
    const url =
      typeof obj.url === "string" && obj.url.startsWith("http")
        ? obj.url
        : `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(String(obj.query || obj.text || "accounting software"))}`;
    obj = { type: "navigate", url, explanation: obj.explanation };
  }
  if (obj.type === "done" && !obj.summary) obj.summary = "Compile verified rows from pages visited";
  if (obj.type === "extract" && !obj.instruction) {
    obj.instruction = "Extract companies and facts from this page";
  }
  return obj;
}

export async function extractFromPage(input: {
  goal: string;
  instruction: string;
  observation: PageObservation;
}): Promise<{
  companies: CompanyResearch[];
  insights?: string;
}> {
  const pageLooksEmpty =
    /does not exist|if this persists|no results matching/i.test(
      `${input.observation.title} ${input.observation.excerpt}`
    );
  if (pageLooksEmpty) {
    return { companies: [], insights: "This page has no extractable company facts." };
  }

  const raw = await chatJson<z.infer<typeof extractSchema>>(
    `Extract ONLY facts that appear in the page text below.
Do not use prior knowledge. Do not invent companies, funding, jobs, or URLs.
If the page is a failed search or says the article does not exist, return { "companies": [], "insights": "Nothing extractable" }.
If a field is not on the page, omit it.
sourceUrl must be exactly the page URL you were given.`,
    `Goal: ${input.goal}
Instruction: ${input.instruction}
URL: ${input.observation.url}
Title: ${input.observation.title}
Page text:
${input.observation.excerpt}`,
    `{ "companies": [{ "name": "", "website": "", "product": "", "targetCustomer": "", "pricing": "", "funding": "", "engineeringOpenings": "", "notes": "" }], "insights": "" }`
  );

  const parsed = extractSchema.parse(raw);
  const excerpt = input.observation.excerpt.toLowerCase();
  let companies: CompanyResearch[] = parsed.companies
    .filter((c) => c.name && !/startup us|does not exist|softbank/i.test(c.name))
    .map((c) => {
      const fundingOnPage =
        Boolean(c.funding) &&
        (excerpt.includes("$") ||
          excerpt.includes("funding") ||
          excerpt.includes("million") ||
          excerpt.includes("series"));
      const jobsOnPage =
        Boolean(c.engineeringOpenings) &&
        (excerpt.includes("engineer") ||
          excerpt.includes("career") ||
          excerpt.includes("hiring") ||
          excerpt.includes("job"));
      return {
        name: c.name,
        website: c.website,
        product: c.product,
        targetCustomer: c.targetCustomer,
        pricing:
          c.pricing && (excerpt.includes("$") || excerpt.includes("pricing") || excerpt.includes("plan"))
            ? c.pricing
            : undefined,
        funding: fundingOnPage ? c.funding : undefined,
        engineeringOpenings: jobsOnPage ? c.engineeringOpenings : undefined,
        notes: c.notes,
        sources: [
          {
            title: input.observation.title || "Source",
            url: input.observation.url,
          },
        ],
      };
    });

  if (companies.length === 0) {
    companies = wikipediaTitleFallback(input.observation);
  }

  return { insights: parsed.insights, companies };
}

function wikipediaTitleFallback(observation: PageObservation): CompanyResearch[] {
  if (!/wikipedia\.org\/wiki\//i.test(observation.url)) return [];
  if (/Special:|Wikipedia:|Help:|File:|Template:|Portal:/i.test(observation.url)) return [];
  const name = observation.title.replace(/\s*[-–]\s*Wikipedia.*$/i, "").trim();
  if (!name || /search results|does not exist|softbank/i.test(name)) return [];
  const blob = `${observation.title} ${observation.excerpt}`;
  if (!/account|bookkeep|invoic|ledger|software|startup|automat|financ|erp|cpa/i.test(blob)) {
    return [];
  }
  const firstSentence = observation.excerpt.split(/(?<=\.)\s/)[0]?.slice(0, 280);
  return [
    {
      name,
      product: firstSentence,
      sources: [{ title: observation.title || name, url: observation.url }],
    },
  ];
}

export async function synthesizeReport(input: {
  goal: string;
  companies: CompanyResearch[];
  pagesVisited: number;
  retries: number;
}): Promise<{ summary: string; companies: CompanyResearch[] }> {
  if (input.companies.length === 0) {
    return {
      summary:
        "No verified company rows. Only pages the agent actually opened are allowed as sources, and none yielded a company the agent could confirm.",
      companies: [],
    };
  }

  const raw = await chatJson<{ summary: string }>(
    `Write a 2-4 sentence summary of the verified research only.
Do not add companies, numbers, jobs, or URLs that are not in the JSON.
If a field is missing, say it was not found on the visited pages.`,
    `Goal: ${input.goal}
Visited pages: ${input.pagesVisited}
Retries: ${input.retries}
Verified companies JSON:
${JSON.stringify(input.companies, null, 2)}`,
    `{ "summary": "..." }`
  );

  return {
    summary: raw.summary,
    companies: input.companies,
  };
}
