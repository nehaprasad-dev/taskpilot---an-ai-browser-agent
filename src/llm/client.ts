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
    : "No page loaded yet. Start by navigating to a search engine or relevant directory.";

  const raw = await chatJson<AgentAction>(
    `You are ResearchPilot, an autonomous browser research agent.
Choose ONE next action to progress the goal.
Prefer DuckDuckGo (https://duckduckgo.com) for search to avoid captchas.
Use company websites, Crunchbase-like public pages, Wellfound, LinkedIn public pages carefully.
Use selectors from the interactive elements list when clicking/typing.
Use extract when the page has useful company facts.
Use checkpoint after discovering a company shortlist or mid-research.
Use ask_human only for consequential navigations (job applications, logins, purchases).
Use done when you have enough verified structured data for a useful comparison.
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
    `{ "type": "navigate|click|type|scroll|extract|wait|ask_human|checkpoint|done", ...fields, "explanation": "..." }`
  );

  const parsed = actionSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new Error("Model returned an action that did not match the expected format");
}

export async function extractFromPage(input: {
  goal: string;
  instruction: string;
  observation: PageObservation;
}): Promise<{
  companies: CompanyResearch[];
  insights?: string;
}> {
  const raw = await chatJson<z.infer<typeof extractSchema>>(
    `Extract structured research facts from the page text.
Only include facts supported by the page. Use uncertain wording when unclear.
If the page lists multiple companies, return multiple entries.`,
    `Goal: ${input.goal}
Instruction: ${input.instruction}
URL: ${input.observation.url}
Title: ${input.observation.title}
Page text:
${input.observation.excerpt}`,
    `{ "companies": [{ "name": "", "website": "", "product": "", "targetCustomer": "", "pricing": "", "funding": "", "engineeringOpenings": "", "notes": "", "sourceTitle": "", "sourceUrl": "" }], "insights": "" }`
  );

  const parsed = extractSchema.parse(raw);
  return {
    insights: parsed.insights,
    companies: parsed.companies.map((c) => ({
      name: c.name,
      website: c.website,
      product: c.product,
      targetCustomer: c.targetCustomer,
      pricing: c.pricing,
      funding: c.funding,
      engineeringOpenings: c.engineeringOpenings,
      notes: c.notes,
      sources:
        c.sourceUrl || input.observation.url
          ? [
              {
                title: c.sourceTitle || input.observation.title || "Source",
                url: c.sourceUrl || input.observation.url,
              },
            ]
          : [],
    })),
  };
}

export async function synthesizeReport(input: {
  goal: string;
  companies: CompanyResearch[];
  pagesVisited: number;
  retries: number;
}): Promise<{ summary: string; companies: CompanyResearch[] }> {
  const raw = await chatJson<{ summary: string; companies: CompanyResearch[] }>(
    `Create a polished final research brief. Keep company facts concise. Fill gaps with "Not found" rather than inventing.`,
    `Goal: ${input.goal}
Companies JSON:
${JSON.stringify(input.companies, null, 2)}`,
    `{ "summary": "...", "companies": [{ "name": "", "website": "", "product": "", "targetCustomer": "", "pricing": "", "funding": "", "engineeringOpenings": "", "sources": [{"title":"","url":""}], "notes": "" }] }`
  );

  return {
    summary: raw.summary,
    companies: (raw.companies || input.companies).map((c) => ({
      ...c,
      sources: c.sources || [],
    })),
  };
}
