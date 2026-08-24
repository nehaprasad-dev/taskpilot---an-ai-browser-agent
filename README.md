# ResearchPilot

ResearchPilot is an observable AI research agent that works in a real browser.

You give it a goal in plain English. It plans the work, opens pages, reads them, extracts what it needs, and shows you everything as it happens. When it’s done, you get a structured comparison with source links.

This is built as a control room, not a chat window. You can see the plan, the live page, and each action. You can pause, stop, require approval for the next browser action, or choose how to recover from a failed step.

## What makes it an agent

- The LLM creates the research plan and chooses structured browser actions from the current page observation.
- Playwright executes those actions in a real Chromium session.
- Every concise decision, action, screenshot, extraction, retry, and error is streamed to the UI over SSE.
- Policy and recovery guardrails keep the demo on-topic and prevent unsupported source rows; they do not supply research facts.
- Final rows are limited to non-Wikipedia source pages the browser actually visited. Missing fields are shown as `Not found`, never invented.

## Example goal

Research 5 AI accounting startups in the US. Find website, product, target customer, pricing, funding, and engineering openings. Verify from their sites and compare.

## How to run locally

1. Install dependencies:

```bash
npm install
```

2. Add your Groq key to a `.env` file:

```bash
cp .env.example .env
```

Then set `GROQ_API_KEY`. You can also set `GROQ_MODEL` if you want a different model.

3. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Stack

- Next.js + TypeScript
- Playwright for the browser
- Groq for the LLM
- SSE to stream agent events to the UI

## How the agent works

1. Create a plan from the goal
2. Look at the current page
3. Ask the model for one next action
4. Run that action in the browser
5. Repeat until the research is done
6. Return a clean table with sources

If something fails, the agent tries safe recovery strategies and then presents **Retry / Skip / Stop** rather than failing silently.

## Controls

- **Pause / Resume** — hold or continue before the next action
- **Stop** — end the run
- **Approve / Reject** — when the agent wants a human decision
- **Checkpoint** — the agent pauses so you can review progress, then continue or stop

## Reliability and trust

- The UI shows concise decision explanations, not private chain-of-thought.
- Browser screenshots and page URLs update during the run.
- Error pages and Wikipedia-only sources are excluded from the final comparison.
- Sessions and browser state live in the Node process, so use a single application instance for this demo.

## Deploy

Playwright needs a normal Node server, so this should not be deployed as Vercel serverless alone.

Use Railway, Render, or Fly. Set `GROQ_API_KEY` there. A Dockerfile plus Railway and Render configuration are included. The service health endpoint is `/api/health`.

```bash
npm run build
npm run start
```

## Project structure

```
src/
  agent/       agent loop and types
  browser/     Playwright actions and screenshots
  llm/         Groq client and prompts
  components/  control room UI
  app/api/     start, stream, and control routes
```
