import { nanoid } from "nanoid";
import type { BrowserContext, Page } from "playwright";
import { EventBus } from "@/lib/events";
import type {
  AgentAction,
  AgentControlCommand,
  AgentEvent,
  AgentStatus,
  CompanyResearch,
  PlanStep,
  ResearchResult,
} from "@/agent/types";
import { createSessionContext } from "@/browser/browser";
import {
  executeAction,
  findAlternativeClickTarget,
  findSearchField,
  openOfficialWebsite,
  openRelevantWikiResult,
} from "@/browser/actions";
import { observePage } from "@/browser/observer";
import {
  isBrokenPage,
  isMissingWikipediaArticle,
  isWikipediaSearchPage,
  searchQueryFromGoal,
  searchUrl,
  topicKeywords,
} from "@/browser/search";
import {
  createPlan,
  decideNextAction,
  extractFromPage,
  synthesizeReport,
} from "@/llm/client";
import { fieldCoverage, filterVerifiedCompanies, mergeCompanies } from "@/agent/recovery";

const MAX_STEPS = 36;
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
  visitedUrls: string[];
  armApproveNext: boolean;
  extractedUrls: string[];
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

  if (command === "arm_approve_next") {
    session.armApproveNext = true;
    emit(session, {
      type: "decision",
      message: "Next browser action will wait for your approval.",
    });
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
    visitedUrls: [],
    armApproveNext: false,
    extractedUrls: [],
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

  emit(session, { type: "status", status: "running", message: "Opening a Wikipedia search for this goal" });
  if (session.plan[0]) {
    updatePlanStatus(session, (_s, i) => i === 0, "active");
  }

  let observation = null as Awaited<ReturnType<typeof observePage>> | null;
  const startUrl = searchUrl(searchQueryFromGoal(session.goal), "wiki");
  emit(session, {
    type: "decision",
    message: `Starting on Wikipedia search: ${startUrl}`,
  });
  emit(session, {
    type: "action_started",
    action: {
      type: "navigate",
      url: startUrl,
      explanation: "Open Wikipedia search results for the goal",
    },
  });
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    session.pagesVisited += 1;
    observation = await observePage(page);
    emitObservation(session, observation);
    const keywords = topicKeywords(session.goal);
    if (
      isWikipediaSearchPage(observation) ||
      isMissingWikipediaArticle(observation) ||
      isBrokenPage(observation)
    ) {
      const opened = await openRelevantWikiResult(page, keywords);
      if (opened) {
        emit(session, {
          type: "decision",
          message: opened.detail,
        });
        observation = await observePage(page);
        emitObservation(session, observation);
      }
    }
    if (observation) {
      await extractCurrentPage(session, observation, "Read the opening page for companies and facts");
    }
    emit(session, {
      type: "action_completed",
      action: {
        type: "navigate",
        url: startUrl,
        explanation: "Wikipedia search opened",
      },
      detail: `On ${observation?.url || startUrl}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open Wikipedia search";
    emit(session, {
      type: "retry",
      attempt: 1,
      reason: message,
      strategy: "The model will try another URL next",
    });
  }

  let activeStep = 0;
  let checkpointShown = false;
  let retryAction: Awaited<ReturnType<typeof decideNextAction>> | null = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    await respectPause(session);
    if (session.abort) {
      await cleanupSession(session);
      return;
    }

    let action: AgentAction;
    if (retryAction) {
      action = retryAction;
      retryAction = null;
    } else {
      try {
        if (
          observation &&
          !session.extractedUrls.includes(observation.url) &&
          !isBrokenPage(observation) &&
          !isMissingWikipediaArticle(observation)
        ) {
          action = {
            type: "extract",
            instruction: "Extract companies and facts that appear on this page.",
            explanation: "Reading the current page before choosing the next click",
          };
        } else {
          action = await decideNextAction({
            goal: session.goal,
            plan: session.plan,
            observation,
            memory: session.memory.slice(-8).join("\n"),
            companies: session.companies,
            stepIndex: activeStep,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Model response was invalid";
        session.retries += 1;
        emit(session, {
          type: "retry",
          attempt: session.retries,
          reason: message,
          strategy: "Continuing with a page-based fallback instead of stopping",
        });
        if (observation && isWikipediaSearchPage(observation)) {
          const opened = await openRelevantWikiResult(page, topicKeywords(session.goal));
          if (opened) {
            observation = await observePage(page);
            emitObservation(session, observation);
          }
          continue;
        }
        if (observation?.url.includes("wikipedia.org/wiki/")) {
          const opened = await openOfficialWebsite(page);
          if (opened) {
            emit(session, { type: "decision", message: opened.detail });
            observation = await observePage(page);
            emitObservation(session, observation);
            continue;
          }
        }
        if (session.retries >= MAX_RETRIES * 4 || session.companies.length >= 3) {
          await finish(session, "Compiling verified rows after the model stopped returning valid actions.");
          return;
        }
        action = {
          type: "extract",
          instruction: "Extract any company names and facts visible on this page.",
          explanation: "Fallback: extract from the current page",
        };
      }
    }

    emit(session, {
      type: "decision",
      message: "explanation" in action ? action.explanation : summarizeAction(action),
    });

    const mutating =
      action.type === "navigate" ||
      action.type === "click" ||
      action.type === "fill" ||
      action.type === "type";

    if (mutating && session.armApproveNext) {
      session.armApproveNext = false;
      const preview = actionPreview(action);
      emit(session, {
        type: "approval_required",
        reason: "Approve this next action before the agent continues.",
        actionPreview: preview,
      });
      emit(session, {
        type: "status",
        status: "awaiting_approval",
        message: preview,
      });
      const command = await waitForControl(session, ["approve", "reject", "stop"]);
      if (command === "stop") {
        session.abort = true;
        emit(session, { type: "status", status: "stopped", message: "Stopped by user" });
        await cleanupSession(session);
        return;
      }
      if (command === "reject") {
        session.memory.push(`Human skipped action: ${preview}`);
        emit(session, {
          type: "decision",
          message: "Skipped this action after you rejected it.",
        });
        emit(session, { type: "status", status: "running" });
        continue;
      }
      emit(session, { type: "status", status: "running", message: "Action approved" });
    }

    if (action.type === "ask_human") {
      emit(session, {
        type: "approval_required",
        reason: action.reason,
        actionPreview: action.proposedAction ?? action.reason,
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
        collected: action.collected ?? [],
        missing: action.missing ?? [],
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
        try {
          observation = await observePage(page);
          emitObservation(session, observation);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not read the page";
          emit(session, {
            type: "retry",
            attempt: 1,
            reason: message,
            strategy: "Will wait and extract after the next navigation",
          });
          continue;
        }
      }
      try {
        if (!session.extractedUrls.includes(observation.url)) {
          session.extractedUrls.push(observation.url);
        }
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
      emit(session, {
        type: "step_failed",
        reason: executed.detail,
        actionLabel: actionPreview(action),
      });
      emit(session, {
        type: "status",
        status: "awaiting_recovery",
        message: executed.detail,
      });
      const command = await waitForControl(session, [
        "retry_step",
        "skip_step",
        "stop",
      ]);
      if (command === "stop") {
        session.abort = true;
        emit(session, { type: "status", status: "stopped", message: "Stopped after a failed step" });
        await cleanupSession(session);
        return;
      }
      if (command === "retry_step") {
        retryAction = action;
        emit(session, { type: "status", status: "running", message: "Retrying the failed step" });
        continue;
      }
      emit(session, {
        type: "decision",
        message: "Skipped this step after retries. Trying another approach.",
      });
      emit(session, { type: "status", status: "running" });
      continue;
    }

    emit(session, {
      type: "action_completed",
      action,
      detail: executed.detail,
    });

    const previousUrl = observation?.url;
    try {
      observation = await observePage(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read the page";
      session.retries += 1;
      emit(session, {
        type: "retry",
        attempt: session.retries,
        reason: message,
        strategy: "Waiting for the page to finish loading, then continuing",
      });
      await page.waitForTimeout(800);
      try {
        observation = await observePage(page);
      } catch {
        session.memory.push(`Could not snapshot ${page.url()}: ${message}`);
        continue;
      }
    }
    emitObservation(session, observation);
    if (observation.url !== previousUrl) {
      session.pagesVisited += 1;
    }
    if (isMissingWikipediaArticle(observation) || isWikipediaSearchPage(observation)) {
      const opened = await openRelevantWikiResult(page, topicKeywords(session.goal));
      if (opened) {
        emit(session, {
          type: "decision",
          message: opened.detail,
        });
        observation = await observePage(page);
        emitObservation(session, observation);
      }
    }

    if (
      (action.type === "navigate" ||
        action.type === "fill" ||
        action.type === "type" ||
        action.type === "click") &&
      isBrokenPage(observation)
    ) {
      emit(session, {
        type: "retry",
        attempt: 1,
        reason: "Search engine blocked the automated browser (blank error page).",
        strategy: "Opening Wikipedia search for this goal instead",
      });
      try {
        await page.goto(searchUrl(searchQueryFromGoal(session.goal), "wiki"), {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        session.pagesVisited += 1;
        observation = await observePage(page);
        emitObservation(session, observation);
        session.memory.push(`Moved to Wikipedia: ${observation.url}`);
      } catch {
        session.memory.push("Could not open Wikipedia search fallback");
      }
    }

    if (action.type === "navigate" || action.type === "fill") {
      maybeAdvancePlan(session, activeStep);
      activeStep = Math.min(activeStep + 1, session.plan.length - 1);
    }

    session.memory.push(`${action.type}: ${executed.detail} @ ${observation.url}`);
  }

  await finish(session, "Reached step limit; compiling the best available research.");
}

async function extractCurrentPage(
  session: SessionState,
  observation: Awaited<ReturnType<typeof observePage>>,
  instruction: string
) {
  if (session.extractedUrls.includes(observation.url)) return;
  session.extractedUrls.push(observation.url);
  if (isBrokenPage(observation) || isMissingWikipediaArticle(observation)) return;

  try {
    const extracted = await extractFromPage({
      goal: session.goal,
      instruction,
      observation,
    });
    session.companies = mergeCompanies(session.companies, extracted.companies);
    if (extracted.insights) session.memory.push(extracted.insights);
    emit(session, {
      type: "extraction",
      data: extracted.companies,
      label: instruction,
    });
    emit(session, {
      type: "decision",
      message:
        extracted.companies.length > 0
          ? `Extracted ${extracted.companies.map((c) => c.name).join(", ")} from this page.`
          : "This page had no extractable company rows.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extract failed";
    session.retries += 1;
    emit(session, {
      type: "retry",
      attempt: session.retries,
      reason: message,
      strategy: "Will try another page next",
    });
  }
}

function emitObservation(
  session: SessionState,
  observation: Awaited<ReturnType<typeof observePage>>
) {
  if (observation.url && !session.visitedUrls.includes(observation.url)) {
    session.visitedUrls.push(observation.url);
  }
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

      let strategy = "Retrying the same action";
      if (action.type === "click") {
        const opened = await openRelevantWikiResult(page, topicKeywords(session.goal));
        if (opened) return opened;
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
        if (alt && !/accessibility|feedback|cookie/i.test(alt)) {
          strategy = `Trying alternative selector: ${alt}`;
          action = { ...action, selector: alt };
        }
      } else if (
        (action.type === "fill" || action.type === "type") &&
        attempt === 2
      ) {
        const alt = await findSearchField(page);
        if (alt) {
          strategy = `Filling an alternative field: ${alt}`;
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
        reason: lastDetail.split("Call log")[0]?.trim().slice(0, 160) || "Click timed out",
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

  session.plan = session.plan.map((step) => {
    if (step.status === "active") return { ...step, status: "done" };
    if (step.status === "pending") return { ...step, status: "skipped" };
    return step;
  });
  emit(session, { type: "plan_updated", steps: session.plan });

  const verified = filterVerifiedCompanies(session.companies, session.visitedUrls);
  session.companies = verified;

  let summary = summaryHint;
  try {
    const synthesized = await synthesizeReport({
      goal: session.goal,
      companies: verified,
      pagesVisited: session.pagesVisited,
      retries: session.retries,
    });
    summary = synthesized.summary || summaryHint;
  } catch {
    summary =
      verified.length === 0
        ? "Research finished, but no company facts could be verified from pages the agent actually opened."
        : summaryHint;
  }

  if (verified.length === 0) {
    summary =
      "Research finished without verified company rows. Search engines blocked the browser, and Wikipedia did not yield official company pages the agent could extract from. No invented companies were added.";
  }

  const sourcesChecked = new Set(
    verified.flatMap((c) => c.sources.map((s) => s.url))
  ).size;

  const result: ResearchResult = {
    goal: session.goal,
    companies: verified,
    summary,
    stats: {
      companiesResearched: verified.length,
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

function actionPreview(action: Parameters<typeof executeAction>[1] | { type: string }) {
  if ("explanation" in action && typeof action.explanation === "string") {
    return action.explanation;
  }
  switch (action.type) {
    case "fill":
    case "type":
      return "Fill a field on the page";
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

function summarizeAction(action: { type: string }) {
  return actionPreview(action);
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
