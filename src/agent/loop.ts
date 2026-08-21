import { nanoid } from "nanoid";
import type { BrowserContext, Page } from "playwright";
import { EventBus } from "@/lib/events";
import type {
  AgentControlCommand,
  AgentEvent,
  AgentStatus,
  CompanyResearch,
  PlanStep,
  ResearchResult,
} from "@/agent/types";
import { createSessionContext } from "@/browser/browser";
import { executeAction, findAlternativeClickTarget } from "@/browser/actions";
import { observePage } from "@/browser/observer";
import {
  createPlan,
  decideNextAction,
  extractFromPage,
  synthesizeReport,
} from "@/llm/client";
import { fieldCoverage, mergeCompanies } from "@/agent/recovery";

const MAX_STEPS = 28;
const MAX_RETRIES = 3;

type SessionState = {
  id: string;
  goal: string;
  status: AgentStatus;
  bus: EventBus;
  plan: PlanStep[];
  companies: CompanyResearch[];
  pagesVisited: number;
  retries: number;
  memory: string[];
  result?: ResearchResult;
  error?: string;
  createdAt: number;
  context?: BrowserContext;
  page?: Page;
  controlWaiters: Array<(command: AgentControlCommand) => void>;
  pendingCommand?: AgentControlCommand;
  abort: boolean;
};

const sessions = new Map<string, SessionState>();

function emit(session: SessionState, event: AgentEvent) {
  if (event.type === "status") {
    session.status = event.status;
  }
  session.bus.emit(event);
}

function updatePlanStatus(
  session: SessionState,
  matcher: (step: PlanStep, index: number) => boolean,
  status: PlanStep["status"]
) {
  session.plan = session.plan.map((step, index) =>
    matcher(step, index) ? { ...step, status } : step
  );
  emit(session, { type: "plan_updated", steps: session.plan });
}

async function waitForControl(
  session: SessionState,
  expected: AgentControlCommand[]
): Promise<AgentControlCommand> {
  if (session.pendingCommand && expected.includes(session.pendingCommand)) {
    const command = session.pendingCommand;
    session.pendingCommand = undefined;
    return command;
  }

  return new Promise((resolve) => {
    session.controlWaiters.push((command) => {
      if (expected.includes(command)) {
        resolve(command);
      } else {
        session.pendingCommand = command;
        resolve(command);
      }
    });
  });
}

async function respectPause(session: SessionState) {
  if (session.abort) return;
  if (session.status === "paused" || session.pendingCommand === "pause") {
    session.pendingCommand = undefined;
    emit(session, { type: "status", status: "paused", message: "Paused by user" });
    const command = await waitForControl(session, ["resume", "stop"]);
    if (command === "stop") {
      session.abort = true;
      emit(session, { type: "status", status: "stopped", message: "Stopped by user" });
      return;
    }
    emit(session, { type: "status", status: "running", message: "Resumed" });
  }
  if (session.pendingCommand === "stop") {
    session.abort = true;
    session.pendingCommand = undefined;
    emit(session, { type: "status", status: "stopped", message: "Stopped by user" });
  }
}

export function getSession(sessionId: string) {
  return sessions.get(sessionId);
}

export function sendControl(sessionId: string, command: AgentControlCommand) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  if (command === "pause") {
    session.pendingCommand = "pause";
    if (session.status === "running") {
      emit(session, { type: "status", status: "paused", message: "Pause requested" });
    }
    return { ok: true };
  }

  if (command === "stop") {
    session.abort = true;
    session.pendingCommand = "stop";
    const waiter = session.controlWaiters.shift();
    if (waiter) waiter("stop");
    emit(session, { type: "status", status: "stopped", message: "Stop requested" });
    return { ok: true };
  }

  const waiter = session.controlWaiters.shift();
  if (waiter) {
    waiter(command);
  } else {
    session.pendingCommand = command;
  }

  if (command === "resume") {
    emit(session, { type: "status", status: "running", message: "Resume requested" });
  }

  return { ok: true };
}

export function subscribeToSession(
  sessionId: string,
  listener: (event: AgentEvent) => void
) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found");
  for (const event of session.bus.getHistory()) {
    listener(event);
  }
  return session.bus.subscribe(listener);
}

export async function startAgentSession(goal: string) {
  const id = nanoid(10);
  const bus = new EventBus();
  const session: SessionState = {
    id,
    goal,
    status: "planning",
    bus,
    plan: [],
    companies: [],
    pagesVisited: 0,
    retries: 0,
    memory: [],
    createdAt: Date.now(),
    controlWaiters: [],
    abort: false,
  };
  sessions.set(id, session);

  emit(session, { type: "session_started", sessionId: id, goal });
  emit(session, { type: "status", status: "planning", message: "Creating research plan" });

  // Fire and forget agent loop; clients subscribe via SSE.
  void runAgent(session).catch(async (error) => {
    const message = error instanceof Error ? error.message : "Unknown agent failure";
    session.error = message;
    emit(session, { type: "error", message, recoverable: false });
    emit(session, { type: "status", status: "error", message });
    await cleanupSession(session);
  });

  return { sessionId: id };
}

async function cleanupSession(session: SessionState) {
  try {
    await session.context?.close();
  } catch {
    // ignore
  }
  session.context = undefined;
  session.page = undefined;
}

async function runAgent(session: SessionState) {
  let plan: PlanStep[];
  try {
    plan = await createPlan(session.goal);
  } catch {
    plan = [
      { id: "step-1", label: "Understand the research goal", status: "pending" },
      { id: "step-2", label: "Search for relevant companies", status: "pending" },
      { id: "step-3", label: "Open and verify company websites", status: "pending" },
      { id: "step-4", label: "Extract product, pricing, funding, and jobs", status: "pending" },
      { id: "step-5", label: "Compile a source-backed comparison", status: "pending" },
    ];
    emit(session, {
      type: "retry",
      attempt: 1,
      reason: "The model could not draft a plan as JSON",
      strategy: "Using a default research plan and continuing",
    });
  }
  session.plan = plan;
  emit(session, { type: "plan_created", steps: plan });

  const { context, page } = await createSessionContext();
  session.context = context;
  session.page = page;

  emit(session, { type: "status", status: "running", message: "Agent running" });
  if (session.plan[0]) {
    updatePlanStatus(session, (_s, i) => i === 0, "active");
  }

  let activeStep = 0;
  let observation = null as Awaited<ReturnType<typeof observePage>> | null;
  let checkpointShown = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    await respectPause(session);
    if (session.abort) {
      await cleanupSession(session);
      return;
    }

    let action;
    try {
      action = await decideNextAction({
        goal: session.goal,
        plan: session.plan,
        observation,
        memory: session.memory.slice(-8).join("\n"),
        companies: session.companies,
        stepIndex: activeStep,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Model response was invalid";
      session.retries += 1;
      emit(session, {
        type: "retry",
        attempt: session.retries,
        reason: message,
        strategy: "Asking the model again with a simpler JSON request",
      });
      if (session.retries >= MAX_RETRIES * 3) {
        await finish(session, "Stopped after repeated model-format failures. Compiling what was collected.");
        return;
      }
      continue;
    }

    emit(session, {
      type: "decision",
      message: "explanation" in action ? action.explanation : summarizeAction(action),
    });

    if (action.type === "ask_human") {
      emit(session, {
        type: "approval_required",
        reason: action.reason,
        actionPreview: action.proposedAction,
      });
      emit(session, {
        type: "status",
        status: "awaiting_approval",
        message: action.reason,
      });

      const command = await waitForControl(session, ["approve", "reject", "stop"]);
      if (command === "stop") {
        session.abort = true;
        emit(session, { type: "status", status: "stopped", message: "Stopped by user" });
        await cleanupSession(session);
        return;
      }
      if (command === "reject") {
        session.memory.push(`Human rejected: ${action.reason}`);
        emit(session, {
          type: "decision",
          message: "Skipped the proposed action after human rejection.",
        });
        emit(session, { type: "status", status: "running" });
        continue;
      }
      emit(session, { type: "status", status: "running", message: "Approved by human" });
      continue;
    }

    if (action.type === "checkpoint") {
      checkpointShown = true;
      emit(session, {
        type: "checkpoint",
        summary: action.summary,
        collected: action.collected,
        missing: action.missing,
      });
      emit(session, {
        type: "status",
        status: "awaiting_checkpoint",
        message: action.summary,
      });
      const command = await waitForControl(session, [
        "continue_checkpoint",
        "stop",
      ]);
      if (command === "stop") {
        session.abort = true;
        emit(session, { type: "status", status: "stopped", message: "Stopped at checkpoint" });
        await cleanupSession(session);
        return;
      }
      emit(session, { type: "status", status: "running", message: "Continuing from checkpoint" });
      continue;
    }

    if (action.type === "done") {
      await finish(session, action.summary);
      return;
    }

    emit(session, { type: "action_started", action });

    if (action.type === "extract") {
      if (!observation) {
        observation = await observePage(page);
        emitObservation(session, observation);
      }
      try {
        const extracted = await extractFromPage({
          goal: session.goal,
          instruction: action.instruction,
          observation,
        });
        session.companies = mergeCompanies(session.companies, extracted.companies);
        if (extracted.insights) {
          session.memory.push(extracted.insights);
        }
        emit(session, {
          type: "extraction",
          data: extracted.companies,
          label: action.instruction,
        });
        emit(session, {
          type: "action_completed",
          action,
          detail: `Extracted ${extracted.companies.length} company record(s)`,
        });
        session.memory.push(`Extracted: ${action.instruction}`);
        maybeAdvancePlan(session, activeStep);
        activeStep = Math.min(activeStep + 1, session.plan.length - 1);

        if (!checkpointShown && session.companies.length >= 3) {
          const coverage = fieldCoverage(session.companies);
          emit(session, {
            type: "checkpoint",
            summary: `Found ${session.companies.length} companies. Review before deepening research.`,
            collected: [
              `Companies: ${session.companies.map((c) => c.name).join(", ")}`,
              ...coverage.collected,
            ],
            missing: coverage.missing,
          });
          emit(session, {
            type: "status",
            status: "awaiting_checkpoint",
            message: "Checkpoint ready",
          });
          checkpointShown = true;
          const command = await waitForControl(session, [
            "continue_checkpoint",
            "stop",
          ]);
          if (command === "stop") {
            session.abort = true;
            emit(session, {
              type: "status",
              status: "stopped",
              message: "Stopped at checkpoint",
            });
            await cleanupSession(session);
            return;
          }
          emit(session, {
            type: "status",
            status: "running",
            message: "Continuing from checkpoint",
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Extraction failed";
        emit(session, {
          type: "retry",
          attempt: 1,
          reason: message,
          strategy: "Will try another page or selector next",
        });
        session.retries += 1;
      }
      continue;
    }

    const executed = await executeWithRecovery(session, page, action);
    if (!executed.ok) {
      session.memory.push(`Failed action ${action.type}: ${executed.detail}`);
      if (session.retries >= MAX_RETRIES * 2) {
        emit(session, {
          type: "error",
          message: `Couldn't reliably complete browser actions. Last issue: ${executed.detail}`,
          recoverable: true,
        });
        await finish(session, "Partial research completed after repeated recovery attempts.");
        return;
      }
      continue;
    }

    emit(session, {
      type: "action_completed",
      action,
      detail: executed.detail,
    });

    if (action.type === "navigate") {
      session.pagesVisited += 1;
      maybeAdvancePlan(session, activeStep);
      activeStep = Math.min(activeStep + 1, session.plan.length - 1);
    }

    observation = await observePage(page);
    emitObservation(session, observation);
    session.memory.push(`${action.type}: ${executed.detail} @ ${observation.url}`);
  }

  await finish(session, "Reached step limit; compiling the best available research.");
}

function emitObservation(
  session: SessionState,
  observation: Awaited<ReturnType<typeof observePage>>
) {
  emit(session, {
    type: "page_observed",
    url: observation.url,
    title: observation.title,
    screenshot: observation.screenshot,
    excerpt: observation.excerpt.slice(0, 500),
  });
}

function maybeAdvancePlan(session: SessionState, activeStep: number) {
  updatePlanStatus(session, (_s, i) => i === activeStep, "done");
  updatePlanStatus(session, (_s, i) => i === activeStep + 1, "active");
}

async function executeWithRecovery(
  session: SessionState,
  page: Page,
  action: Parameters<typeof executeAction>[1]
) {
  let lastDetail = "";
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await executeAction(page, action);
      return result;
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : "Action failed";
      session.retries += 1;
      emit(session, {
        type: "status",
        status: "recovering",
        message: lastDetail,
      });

      let strategy = "Retrying the same action";
      if (action.type === "click" && attempt === 2) {
        const keywords = action.selector
          .replace(/^text=/, "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3);
        const alt = await findAlternativeClickTarget(page, [
          ...keywords,
          "pricing",
          "plans",
          "careers",
          "jobs",
          "about",
        ]);
        if (alt) {
          strategy = `Trying alternative selector: ${alt}`;
          action = { ...action, selector: alt };
        }
      } else if (action.type === "navigate" && attempt >= 2) {
        strategy = "Waiting and retrying navigation";
        await page.waitForTimeout(1200);
      } else if (attempt === 3) {
        strategy = "Scrolling and retrying";
        await page.mouse.wheel(0, 600);
      }

      emit(session, {
        type: "retry",
        attempt,
        reason: lastDetail,
        strategy,
      });
    }
  }

  emit(session, { type: "status", status: "running" });
  return { ok: false, detail: lastDetail || "Action failed after retries" };
}

async function finish(session: SessionState, summaryHint: string) {
  emit(session, {
    type: "status",
    status: "running",
    message: "Compiling structured report",
  });

  session.plan = session.plan.map((step) =>
    step.status === "pending" || step.status === "active"
      ? { ...step, status: "done" }
      : step
  );
  emit(session, { type: "plan_updated", steps: session.plan });

  let summary = summaryHint;
  let companies = session.companies;
  try {
    const synthesized = await synthesizeReport({
      goal: session.goal,
      companies: session.companies,
      pagesVisited: session.pagesVisited,
      retries: session.retries,
    });
    summary = synthesized.summary || summaryHint;
    companies = synthesized.companies;
  } catch {
    summary = summaryHint;
  }

  const sourcesChecked = new Set(
    companies.flatMap((c) => c.sources.map((s) => s.url))
  ).size;

  const result: ResearchResult = {
    goal: session.goal,
    companies,
    summary,
    stats: {
      companiesResearched: companies.length,
      sourcesChecked,
      pagesVisited: session.pagesVisited,
      retries: session.retries,
    },
  };

  session.result = result;
  emit(session, { type: "completed", result });
  emit(session, { type: "status", status: "completed", message: "Research complete" });
  await cleanupSession(session);
}

function summarizeAction(action: { type: string }) {
  switch (action.type) {
    case "ask_human":
      return "Waiting for human approval";
    case "checkpoint":
      return "Reached a research checkpoint";
    case "done":
      return "Wrapping up research";
    default:
      return `Next: ${action.type}`;
  }
}

// Cleanup old sessions periodically
setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) {
      void cleanupSession(session);
      sessions.delete(id);
    }
  }
}, 1000 * 60 * 10).unref?.();
