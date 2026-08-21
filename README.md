# ResearchPilot

An AI web research agent that turns a plain-English goal into an **observable, steerable browser workflow**.

It plans dynamically, drives a real Chromium session with Playwright, streams decisions / actions / screenshots over SSE, recovers from failures, pauses for human approval or checkpoints, and finishes with a source-backed comparison table.

## Demo goal

> Research 5 AI accounting startups in the US. Find their website, product, target customer, pricing, funding, and current engineering openings. Verify the information from their websites and give me a comparison.

## Stack

- **Frontend:** Next.js (App Router), TypeScript, Tailwind
- **Agent loop:** observe → LLM decides one action → execute → observe
- **Browser:** Playwright (Chromium)
- **LLM:** Groq (OpenAI-compatible chat completions + JSON)
- **Streaming:** Server-Sent Events

## Why this is not a chatbot

The main screen is an agent control room:

- Plan panel with live step status
- Live browser screenshots
- Activity feed of decisions and actions (concise explanations, not raw chain-of-thought)
- Pause / Resume / Stop
- Approval gates for consequential actions
- Mid-run checkpoints to review progress before continuing
- Structured final report with source links

## Local setup

```bash
npm install
npx playwright install chromium
cp .env.example .env.local
# put your Groq key in .env as GROQ_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy notes

A real browser agent needs a long-running Node server (Playwright will not work on Vercel serverless alone).

Good options:

- **Railway / Render / Fly.io** — deploy this Next.js app as a Node service
- Ensure Chromium system deps are available (`npx playwright install --with-deps chromium` in the build/start phase)
- Set `GROQ_API_KEY` (and optionally `GROQ_MODEL`) in the host env

Suggested start command:

```bash
npx playwright install chromium && npm run build && npm run start
```

## Architecture

```
UI (control room)
   │  POST /api/agent/start
   │  GET  /api/agent/stream  (SSE)
   │  POST /api/control
   ▼
Agent session (in-memory)
   ├── Planner LLM
   ├── Decision LLM (one action at a time)
   ├── Playwright executor + screenshot observer
   ├── Recovery (retries + alternate selectors)
   └── Result synthesizer → structured table
```

## Human control

| Control | Behavior |
|---|---|
| Pause | Stops before the next action |
| Resume | Continues the loop |
| Stop | Terminates the run |
| Approve / Reject | Gates `ask_human` actions |
| Checkpoint Continue | Confirms mid-research progress |

## Project layout

```
src/
  agent/          # loop, types, recovery helpers
  browser/        # Playwright session, actions, screenshots, observe
  llm/            # Groq (OpenAI-compatible) client + structured prompts
  components/     # control-room UI
  app/api/        # start, stream, control
```

## Evaluation checklist

- [x] Natural-language goal
- [x] Multi-step browser actions with LLM in the loop (not a hardcoded script)
- [x] Live streaming of decisions, actions, and page screenshots
- [x] Pause / stop / approve human control
- [x] Recovery with retries and clear failure reporting
- [x] Structured, source-backed final result
- [x] Differentiator: research checkpoints for steerability
