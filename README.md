# ResearchPilot

ResearchPilot is an AI research agent that works in a real browser.

You give it a goal in plain English. It plans the work, opens pages, reads them, extracts what it needs, and shows you everything as it happens. When it’s done, you get a structured comparison with source links.

This is built as a control room, not a chat window. You can see the plan, the live page, and each action. You can pause, stop, or approve a step when the agent asks.

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

If something fails, it retries a few times and tells you what went wrong.

## Controls

- **Pause / Resume** — hold or continue before the next action
- **Stop** — end the run
- **Approve / Reject** — when the agent wants a human decision
- **Checkpoint** — review progress mid-run, then continue or stop

## Deploy

Playwright needs a normal Node server, so this should not be deployed as Vercel serverless alone.

Use Railway, Render, or Fly. Set `GROQ_API_KEY` there. A Dockerfile is included for that setup.

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
