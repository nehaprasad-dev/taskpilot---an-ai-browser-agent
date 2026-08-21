# ResearchPilot

ResearchPilot is an AI agent that does web research in a real browser.

You type a goal in plain English. The agent writes a plan, searches and opens sites, reads the pages, extracts facts, and keeps going until it can put together a comparison. The whole time you can see what it is doing: the plan, the current page, and a live activity log.

It is not a chatbot. The main screen is a control room so a person can follow the work and steer it.

## What it does

The demo task is competitive research, for example:

> Research 5 AI accounting startups in the US. Find website, product, target customer, pricing, funding, and engineering openings. Verify from their sites and compare.

For each company it tries to collect:

- name and website
- product
- target customer
- pricing
- funding
- engineering openings
- source URLs so you can check the claim

When the run finishes you get a table plus a short summary, including how many companies, sources, pages, and retries it used.

It will also work with other similar research goals (other markets, fewer companies, a slightly different set of fields). It is built around this one workflow, not as a general-purpose browser agent.

## What you see

| Area | Purpose |
|---|---|
| Goal | The research request you started |
| Plan | Steps the agent drafted, with current / done / pending |
| Live browser | Screenshot of the page Playwright is on, plus the URL |
| Agent activity | Decisions and actions as they happen, in short language |
| Controls | Pause, resume, stop, and approval / checkpoint when needed |
| Results | Comparison table with source links |

The activity feed shows what the agent decided and what it did. It does not dump hidden chain-of-thought.

## Requirements

- Node.js 20+
- A Groq API key ([console.groq.com](https://console.groq.com))
- Chromium for Playwright (`npm install` runs `playwright install chromium`)

## Run locally

```bash
npm install
cp .env.example .env
```

Put your key in `.env`:

```bash
GROQ_API_KEY=gsk_your_key
GROQ_MODEL=openai/gpt-oss-120b
```

`GROQ_MODEL` is optional. The default is `openai/gpt-oss-120b`. Other models on many Groq accounts: `openai/gpt-oss-20b`, `qwen/qwen3.6-27b`. Use a model your key can actually call.

Then:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter a goal or use an example, and click **Start research**.

If you change `.env`, restart the dev server so the key is picked up.

## How a run works

1. You submit a goal.
2. The planner model writes a short step list.
3. Playwright opens a headless Chromium session.
4. The loop is: observe the page → model picks **one** action → run it → observe again.
5. Facts from pages are merged into company rows.
6. At a few points the UI may pause for a checkpoint or for approval.
7. When the model says it is done, or it hits a step limit, it compiles the table.

Actions the model can choose:

- **navigate** — go to a URL
- **click** — click something on the page
- **fill** — fill a search box or form field, optionally submit with Enter
- **type** — same as fill (kept for the model)
- **scroll** — move the page
- **extract** — pull structured facts from the current page
- **wait** — brief wait for the page
- **ask_human** — ask you before a consequential step
- **checkpoint** — show what is collected vs still missing
- **done** — finish and write the report

This is not a hardcoded script of clicks. The next click or URL comes from the model looking at the current page.

## If it gets stuck

Clicks and navigation retry up to 3 times. On retry it may try another selector (for example Pricing vs Plans) or wait and try again.

If the model returns invalid JSON, it asks again instead of failing silently.

If a click, fill, or navigation still fails after 3 tries, the run pauses. You get **Retry**, **Skip**, or **Stop**. Nothing fails silently.

## Human control

| Control | What it does |
|---|---|
| Pause | Stops before the next action |
| Resume | Continues |
| Stop | Ends the session |
| Approve next action | The following navigate / click / fill waits for Approve or Reject |
| Approve / Reject | Confirm or skip that step |
| Retry / Skip / Stop | After a step fails three times |
| Checkpoint Continue | Review progress, then keep going or stop |

## API

The UI talks to a small Next.js backend (sessions live in memory on that process):

| Endpoint | Role |
|---|---|
| `POST /api/agent/start` | Start a run with `{ "goal": "..." }`, returns `{ "sessionId": "..." }` |
| `GET /api/agent/stream?sessionId=...` | SSE stream of plan, actions, screenshots, errors, result |
| `POST /api/control` | `{ "sessionId", "command" }` — `pause`, `resume`, `stop`, `approve`, `reject`, `continue_checkpoint`, `arm_approve_next`, `retry_step`, `skip_step` |

## Layout

```
src/
  agent/           loop, types, merging/recovery helpers
  browser/         Playwright session, click/type/navigate, screenshots
  llm/             Groq client and prompts
  lib/             event bus for SSE
  components/agent control room (plan, browser, activity, controls)
  components/results  final table
  app/api/         start, stream, control
```

## Deploy

Playwright needs a long-running Node process. Vercel serverless alone is not enough.

Use Railway, Render, or Fly. There is a `Dockerfile`, `railway.toml`, and `render.yaml`.

Set `GROQ_API_KEY` (and optionally `GROQ_MODEL`) on the host. The container listens on `PORT`.

```bash
npm run build
npm run start
```

Without Docker, install Chromium with system deps on the host:

```bash
npx playwright install --with-deps chromium
```

## Limits

- One server process holds sessions in memory. Restarting the app drops in-flight runs.
- Sites with CAPTCHAs, logins, or heavy bot blocking will fail; the agent reports that instead of trying to bypass them.
- Research quality depends on the Groq model and what the public pages actually contain. Missing fields show as “Not found”, not invented numbers.
- Do not commit `.env`. Only `.env.example` belongs in git.
