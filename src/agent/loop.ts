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
  findOfficialWebsiteHref,
  openOfficialWebsite,
  openRelevantWikiResult,
  scrapeWikiCompanyNames,
} from "@/browser/actions";
import { gotoPage } from "@/browser/navigate";
import { observePage } from "@/browser/observer";
import {
  isBrokenPage,
  isMissingWikipediaArticle,
  isOffTopicPage,
  isWikipediaSearchPage,
  searchQueryFromGoal,
  searchUrl,
  topicKeywords,
  wikiQueriesForGoal,
} from "@/browser/search";
import {
  isBlockedUrl,
  isDeadPage,
  isFamousAiLab,
  isIncumbentHost,
  isIncumbentVendor,
  isOpenSourceErp,
  isUselessWikiPage,
  isWikipediaListPage,
  cloudAccountingLookups,
  officialSiteForName,
} from "@/browser/policy";
import { isNetworkFailure, networkFailureMessage } from "@/lib/errors";
import {
  createPlan,
  decideNextAction,
  extractFromPage,
  synthesizeReport,
} from "@/llm/client";
import {
  filterVerifiedCompanies,
  isJunkCompanyName,
  mergeCompanies,
} from "@/agent/recovery";

const MAX_STEPS = 36;
const MAX_RETRIES = 1;

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
  officialOpened: string[];
  queryIndex: number;
  probedOrigins: string[];
  skippedNames: string[];
  lastNavigationTarget?: string;
  repeatedNavigationCount: number;
};

const globalStore = globalThis as typeof globalThis & {
  __researchPilotSessions?: Map<string, SessionState>;
};
const sessions =
  globalStore.__researchPilotSessions ?? new Map<string, SessionState>();
globalStore.__researchPilotSessions = sessions;

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function isWikiUrl(url?: string) {
  return Boolean(url && /wikipedia\.org|wikimedia\.org/i.test(url));
}

function companiesWithOfficialSites(session: SessionState) {
  return session.companies.filter(
    (company) =>
      !isFamousAiLab(company.name, session.goal) &&
      !isJunkCompanyName(company.name) &&
      !isIncumbentVendor(company.name) &&
      !isOpenSourceErp(company.name) &&
      Boolean(company.website && !isWikiUrl(company.website))
  );
}

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
  for (;;) {
    if (session.pendingCommand && expected.includes(session.pendingCommand)) {
      const command = session.pendingCommand;
      session.pendingCommand = undefined;
      return command;
    }

    const command = await new Promise<AgentControlCommand>((resolve) => {
      session.controlWaiters.push(resolve);
    });

    if (expected.includes(command)) {
      return command;
    }

    // Queue unexpected commands (e.g. pause during approval) without treating them
    // as approve/continue/skip.
    session.pendingCommand = command;
  }
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

export async function waitForSession(sessionId: string, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const session = sessions.get(sessionId);
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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
    companies: cloudAccountingLookups(goal).map((name) => ({
      name,
      sources: [],
    })),
    pagesVisited: 0,
    retries: 0,
    memory: [],
    createdAt: Date.now(),
    controlWaiters: [],
    abort: false,
    visitedUrls: [],
    armApproveNext: false,
    extractedUrls: [],
    officialOpened: [],
    queryIndex: 0,
    probedOrigins: [],
    skippedNames: [],
    repeatedNavigationCount: 0,
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
      { id: "step-1", label: "Open official company websites", status: "pending" },
      { id: "step-2", label: "Read product and customer from each homepage", status: "pending" },
      { id: "step-3", label: "Open pricing pages", status: "pending" },
      { id: "step-4", label: "Open careers pages", status: "pending" },
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

  emit(session, { type: "status", status: "running", message: "Opening the first official company website" });
  if (session.plan[0]) {
    updatePlanStatus(session, (_s, i) => i === 0, "active");
  }

  let observation = null as Awaited<ReturnType<typeof observePage>> | null;
  const startUrl = /account|bookkeep/i.test(session.goal)
    ? officialSiteForName("Xero") || "https://www.xero.com"
    : searchUrl(searchQueryFromGoal(session.goal), "wiki");
  emit(session, {
    type: "decision",
    message: `Starting on an official company site: ${startUrl}`,
  });
  emit(session, {
    type: "action_started",
    action: {
      type: "navigate",
      url: startUrl,
      explanation: "Open the official website",
    },
  });
  try {
    const navigated = await gotoPage(page, startUrl);
    if (!navigated.ok) {
      throw new Error(navigated.detail);
    }
    session.pagesVisited += 1;
    // Always publish a viewport frame after the first navigation so production
    // never sits on about:blank while the agent is already working.
    try {
      observation = await observePage(page);
      emitObservation(session, observation);
    } catch (observeError) {
      const message =
        observeError instanceof Error ? observeError.message : "Could not snapshot page";
      emit(session, {
        type: "page_observed",
        url: navigated.url || startUrl,
        title: "Page loading…",
        screenshot: "",
        excerpt: message,
      });
    }
    const keywords = topicKeywords(session.goal);
    if (
      observation?.url.includes("wikipedia.org") &&
      (isWikipediaSearchPage(observation) ||
        isMissingWikipediaArticle(observation) ||
        isBrokenPage(observation))
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
    if (session.plan[0]) {
      updatePlanStatus(session, (_s, i) => i === 0, "done");
      if (session.plan[1]) updatePlanStatus(session, (_s, i) => i === 1, "active");
    }
    emit(session, {
      type: "action_completed",
      action: {
        type: "navigate",
        url: startUrl,
        explanation: "Official website opened",
      },
      detail: `On ${observation?.url || navigated.url || startUrl}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open the official website";
    if (isNetworkFailure(message)) {
      emit(session, {
        type: "error",
        message: networkFailureMessage(message),
        recoverable: false,
      });
      emit(session, {
        type: "page_observed",
        url: startUrl,
        title: "Could not load page",
        screenshot: "",
        excerpt: networkFailureMessage(message),
      });
      await finish(session, networkFailureMessage(message));
      return;
    }
    emit(session, {
      type: "retry",
      attempt: 1,
      reason: message,
      strategy: "The model will try another URL next",
    });
  }

  let activeStep = 0;
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
        if (observation && isOffTopicPage(observation, session.goal)) {
          action = {
            type: "navigate",
            url: searchUrl(searchQueryFromGoal(session.goal), "wiki"),
            explanation: "Left an off-topic page and returned to Wikipedia search for the goal",
          };
        } else if (
          observation &&
          !observation.url.includes("wikipedia.org") &&
          !session.extractedUrls.includes(observation.url) &&
          !isBrokenPage(observation) &&
          !isDeadPage(observation) &&
          !isBlockedUrl(observation.url) &&
          !isMissingWikipediaArticle(observation) &&
          !isWikipediaSearchPage(observation) &&
          !isOffTopicPage(observation, session.goal)
        ) {
          action = {
            type: "extract",
            instruction: "Extract only companies that match the research goal from this page.",
            explanation: "Reading the current page before choosing the next click",
          };
        } else {
          const heuristic = await pickFastAction(session, observation);
          action =
            heuristic ??
            (await decideNextAction({
              goal: session.goal,
              plan: session.plan,
              observation,
              memory: session.memory.slice(-8).join("\n"),
              companies: session.companies,
              stepIndex: activeStep,
            }));
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

    if (action.type === "navigate") {
      // Render cannot load careers.* hosts reliably — skip them in production.
      if (
        process.env.NODE_ENV === "production" &&
        /careers\.|\/careers|greenhouse\.io|lever\.co|workday/i.test(action.url)
      ) {
        session.probedOrigins.push(action.url);
        const alternative = nextUnvisitedOfficialUrl(session, observation?.url);
        if (alternative) {
          emit(session, {
            type: "decision",
            message: `Skipped slow careers page; opening ${alternative}`,
          });
          action = {
            type: "navigate",
            url: alternative,
            explanation: "Skip careers host — open next official company site",
          };
        } else {
          emit(session, {
            type: "decision",
            message: "Skipped a slow careers page and continued research.",
          });
          continue;
        }
      }

      const target = normalizePageUrl(action.url);
      if (target === session.lastNavigationTarget) {
        session.repeatedNavigationCount += 1;
      } else {
        session.lastNavigationTarget = target;
        session.repeatedNavigationCount = 0;
      }
      if (session.repeatedNavigationCount >= 1) {
        const alternative = nextUnvisitedOfficialUrl(session, observation?.url);
        if (alternative && normalizePageUrl(alternative) !== target) {
          emit(session, {
            type: "retry",
            attempt: session.retries + 1,
            reason: `The agent selected ${action.url} again`,
            strategy: `Loop prevented; moving to ${alternative}`,
          });
          session.retries += 1;
          action = {
            type: "navigate",
            url: alternative,
            explanation: "Loop prevented — open an unvisited official company site",
          };
          session.lastNavigationTarget = normalizePageUrl(alternative);
          session.repeatedNavigationCount = 0;
        }
      }
    }

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
      emit(session, {
        type: "checkpoint",
        summary: action.summary,
        collected: action.collected,
        missing: action.missing,
      });
      emit(session, {
        type: "status",
        status: "awaiting_checkpoint",
        message: "Review progress before the agent continues",
      });
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
        message: "Checkpoint approved — continuing",
      });
      continue;
    }

    if (action.type === "done") {
      const usable = companiesWithOfficialSites(session).filter(
        (c) => c.product || c.pricing || c.targetCustomer
      );
      if (usable.length < 3 && step < MAX_STEPS - 2) {
        const nextSite = nextOfficialUrl(session, observation?.url);
        emit(session, {
          type: "decision",
          message: nextSite
            ? `Need more official-site rows — opening the next company site.`
            : "Need more official-site facts before finishing.",
        });
        action = {
          type: "navigate",
          url: nextSite || nextWikiSearch(session, observation?.url),
          explanation: nextSite
            ? "Open the next official website"
            : "Keep researching until official-site facts are collected",
        };
      } else {
        await finish(session, action.summary);
        return;
      }
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
        const extracted = await extractFromPage({
          goal: session.goal,
          instruction: action.instruction,
          observation,
        });
        const bound = bindExtractToHost(session, observation, extracted.companies);
        session.companies = mergeCompanies(session.companies, bound).filter(
          (c) =>
            !isFamousAiLab(c.name, session.goal) &&
            !isJunkCompanyName(c.name) &&
            !isIncumbentVendor(c.name) &&
            !isOpenSourceErp(c.name)
        );
        if (!session.extractedUrls.includes(observation.url)) {
          session.extractedUrls.push(observation.url);
        }
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
      } catch (error) {
        const message = error instanceof Error ? error.message : "Extraction failed";
        emit(session, {
          type: "retry",
          attempt: 1,
          reason: message,
          strategy: "Will try another page or selector next",
        });
        session.retries += 1;
        if (observation && !session.extractedUrls.includes(observation.url)) {
          session.extractedUrls.push(observation.url);
        }
      }
      continue;
    }

    const executed = await executeWithRecovery(session, page, action);
    if (!executed.ok) {
      if (isNetworkFailure(executed.detail)) {
        emit(session, {
          type: "page_observed",
          url: page.url() || startUrl,
          title: "Could not load page",
          screenshot: "",
          excerpt: networkFailureMessage(executed.detail),
        });
        await finish(session, networkFailureMessage(executed.detail));
        return;
      }

      // Timed-out navigations should not open the recovery modal — that is why
      // production demos feel stuck compared to local. In production, skip any
      // failed navigate and keep moving to the next company page.
      const timedOutNav =
        action.type === "navigate" && /timeout/i.test(executed.detail);
      const skipSlowNav =
        timedOutNav ||
        (process.env.NODE_ENV === "production" && action.type === "navigate");
      if (skipSlowNav) {
        session.retries += 1;
        if (action.type === "navigate") {
          session.probedOrigins.push(action.url);
        }
        emit(session, {
          type: "retry",
          attempt: session.retries,
          reason: executed.detail.split("Call log")[0]?.trim().slice(0, 180) || executed.detail,
          strategy: "Skipped the slow page and continued",
        });
        emit(session, {
          type: "decision",
          message: "Skipped a slow page so the research can keep moving.",
        });
        continue;
      }

      emit(session, {
        type: "retry",
        attempt: session.retries + 1,
        reason: executed.detail.split("Call log")[0]?.trim().slice(0, 180) || executed.detail,
        strategy: "Waiting for you to retry, skip, or stop",
      });
      emit(session, {
        type: "step_failed",
        reason:
          executed.detail.split("Call log")[0]?.trim().slice(0, 180) ||
          executed.detail,
        actionLabel: actionPreview(action),
      });
      emit(session, {
        type: "status",
        status: "awaiting_recovery",
        message: "Choose how the agent should recover",
      });
      const command = await waitForControl(session, [
        "retry_step",
        "skip_step",
        "stop",
      ]);
      if (command === "stop") {
        session.abort = true;
        emit(session, {
          type: "status",
          status: "stopped",
          message: "Stopped during recovery",
        });
        await cleanupSession(session);
        return;
      }
      if (command === "retry_step") {
        retryAction = action;
        emit(session, {
          type: "status",
          status: "recovering",
          message: "Retrying the failed action",
        });
        continue;
      }
      session.memory.push(`Human skipped failed ${action.type}: ${executed.detail}`);
      emit(session, {
        type: "decision",
        message: "Skipped the failed action and continued with the plan.",
      });
      emit(session, {
        type: "status",
        status: "running",
        message: "Continuing after the skipped action",
      });
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
        const fallbackUrl = page.url() || previousUrl || "";
        emit(session, {
          type: "page_observed",
          url: fallbackUrl,
          title: "Page loading…",
          screenshot: "",
          excerpt: message,
        });
        session.memory.push(`Could not snapshot ${fallbackUrl}: ${message}`);
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
          timeout: 15000,
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

function sameCompanyHost(a: string, b: string) {
  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  };
  const left = host(a);
  const right = host(b);
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function normalizePageUrl(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.hostname.replace(/^www\./, "").toLowerCase()}${path}`;
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

function hasVisitedPage(session: SessionState, url: string) {
  const target = normalizePageUrl(url);
  return session.visitedUrls.some((visited) => normalizePageUrl(visited) === target);
}

function nextUnvisitedOfficialUrl(
  session: SessionState,
  currentUrl?: string
): string | undefined {
  for (const company of session.companies) {
    const site = officialSiteForName(company.name);
    if (!site || session.skippedNames.includes(company.name.toLowerCase())) continue;
    if (sameCompanyHost(site, currentUrl || "")) continue;
    if (!hasVisitedPage(session, site)) return site;
  }
  return undefined;
}

function bindExtractToHost(
  session: SessionState,
  observation: { url: string; title: string },
  companies: CompanyResearch[]
): CompanyResearch[] {
  const seed = session.companies.find((company) => {
    const site = officialSiteForName(company.name);
    return Boolean(site && sameCompanyHost(site, observation.url));
  });
  if (!seed) return companies;
  if (/403|404|forbidden|not found|access denied/i.test(observation.title)) {
    return [];
  }
  const site = officialSiteForName(seed.name) || observation.url;
  const match =
    companies.find((company) => {
      const a = company.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const b = seed.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      return a === b || a.includes(b) || b.includes(a);
    }) || companies[0];
  if (!match) {
    return [
      {
        name: seed.name,
        website: site,
        sources: [{ title: observation.title, url: observation.url }],
      },
    ];
  }
  return [
    {
      ...match,
      name: seed.name,
      website: site,
      sources: [...(match.sources || []), { title: observation.title, url: observation.url }],
    },
  ];
}

function stampSeedWebsite(session: SessionState, url: string, title?: string) {
  if (isWikiUrl(url) || isBlockedUrl(url)) return;
  if (/403|404|forbidden|not found|access denied/i.test(title || "")) return;
  session.companies = session.companies.map((company) => {
    const site = officialSiteForName(company.name);
    if (!site || !sameCompanyHost(site, url)) return company;
    const sources = [...(company.sources || [])];
    if (!sources.some((source) => source.url === url)) {
      sources.push({ title: title || company.name, url });
    }
    return {
      ...company,
      website: company.website && !isWikiUrl(company.website) ? company.website : url.split("#")[0],
      sources,
    };
  });
}

function wikiTitleName(observation: Awaited<ReturnType<typeof observePage>>) {
  return observation.title.replace(/\s*[-–].*$/, "").trim();
}

function skipCompany(session: SessionState, name: string) {
  const key = name.toLowerCase();
  if (key && !session.skippedNames.includes(key)) session.skippedNames.push(key);
}

function nextUnverifiedName(session: SessionState): string | undefined {
  return session.companies.find((c) => {
    if (isFamousAiLab(c.name, session.goal)) return false;
    if (isJunkCompanyName(c.name) || isIncumbentVendor(c.name) || isOpenSourceErp(c.name)) {
      return false;
    }
    if (session.skippedNames.includes(c.name.toLowerCase())) return false;
    const site = officialSiteForName(c.name);
    const onOfficial =
      Boolean(c.website && !isWikiUrl(c.website) && (!site || sameCompanyHost(c.website, site)));
    const hasFacts = Boolean(c.product || c.pricing || c.targetCustomer);
    return !onOfficial || !hasFacts;
  })?.name;
}

function nextOfficialUrl(session: SessionState, currentUrl?: string): string | undefined {
  const unvisited = nextUnvisitedOfficialUrl(session, currentUrl);
  if (unvisited) return unvisited;
  const pending = nextUnverifiedName(session);
  const pendingSite = pending ? officialSiteForName(pending) : undefined;
  if (
    pendingSite &&
    !sameCompanyHost(pendingSite, currentUrl || "") &&
    !hasVisitedPage(session, pendingSite)
  ) {
    return pendingSite;
  }
  for (const company of session.companies) {
    const site = officialSiteForName(company.name);
    if (!site) continue;
    if (session.skippedNames.includes(company.name.toLowerCase())) continue;
    if (sameCompanyHost(site, currentUrl || "")) continue;
    const hasFacts = Boolean(company.product || company.pricing || company.targetCustomer);
    if (!hasFacts && !hasVisitedPage(session, site)) return site;
  }
  return undefined;
}

function nextWikiSearch(session: SessionState, currentUrl?: string): string {
  const queries = wikiQueriesForGoal(session.goal);
  for (let i = 0; i < queries.length; i++) {
    const url = searchUrl(queries[session.queryIndex % queries.length], "wiki");
    session.queryIndex += 1;
    if (url !== currentUrl) return url;
  }
  return searchUrl("accounting software", "wiki");
}

async function pickFastAction(
  session: SessionState,
  observation: Awaited<ReturnType<typeof observePage>> | null
): Promise<AgentAction | null> {
  if (!observation) {
    const first = nextUnverifiedName(session);
    const firstSite = first ? officialSiteForName(first) : undefined;
    return {
      type: "navigate",
      url: firstSite || nextWikiSearch(session),
      explanation: firstSite
        ? `Open ${first}'s official website`
        : "Open Wikipedia search for the goal",
    };
  }
  const pending = nextUnverifiedName(session);
  const pendingSite = pending ? officialSiteForName(pending) : undefined;
  const deadCompanyPage =
    (isDeadPage(observation) || isBrokenPage(observation)) && !isWikiUrl(observation.url);
  if (
    !deadCompanyPage &&
    (isDeadPage(observation) ||
      isBlockedUrl(observation.url) ||
      isOffTopicPage(observation, session.goal) ||
      isBrokenPage(observation) ||
      isUselessWikiPage(observation))
  ) {
    return {
      type: "navigate",
      url: pendingSite || nextWikiSearch(session, observation.url),
      explanation: pending
        ? `Left an off-topic page and opening ${pending}'s site`
        : "Left an off-topic page",
    };
  }
  if (isWikipediaSearchPage(observation) || isMissingWikipediaArticle(observation)) {
    if (pendingSite) {
      return {
        type: "navigate",
        url: pendingSite,
        explanation: `Open ${pending}'s official website`,
      };
    }
    return {
      type: "click",
      selector: ".mw-search-result-heading a",
      explanation: "Open the most relevant Wikipedia result",
    };
  }
  if (isWikipediaListPage(observation) && pendingSite && pending) {
    return {
      type: "navigate",
      url: pendingSite,
      explanation: `Open ${pending}'s official website`,
    };
  }
  if (
    observation.url.includes("wikipedia.org/wiki/") &&
    !isWikipediaListPage(observation)
  ) {
    const articleName = wikiTitleName(observation);
    if (isIncumbentVendor(articleName) || isOpenSourceErp(articleName)) {
      skipCompany(session, articleName);
      return {
        type: "navigate",
        url: pendingSite || nextWikiSearch(session, observation.url),
        explanation: `Skipped ${articleName}. Opening the next official website.`,
      };
    }
    const mapped = officialSiteForName(articleName) || pendingSite;
    if (
      session.extractedUrls.includes(observation.url) &&
      !session.officialOpened.includes(observation.url)
    ) {
      const href = session.page ? await findOfficialWebsiteHref(session.page) : null;
      const target =
        (href && !isIncumbentHost(href) && !isBlockedUrl(href) && href) || mapped;
      session.officialOpened.push(observation.url);
      if (target) {
        return {
          type: "navigate",
          url: target,
          explanation: `Open the official website: ${target}`,
        };
      }
      skipCompany(session, articleName);
      return {
        type: "navigate",
        url: pendingSite || nextWikiSearch(session, observation.url),
        explanation: `No official website on ${articleName}; trying the next company`,
      };
    }
  }
  if (!isWikiUrl(observation.url) && session.extractedUrls.includes(observation.url)) {
    const currentCompany = session.companies.find((company) => {
      const site = officialSiteForName(company.name);
      return Boolean(site && sameCompanyHost(site, observation.url));
    });
    const needsPricing = Boolean(currentCompany && !currentCompany.pricing);
    const isProd = process.env.NODE_ENV === "production";
    const origin = originOf(observation.url);

    if (origin) {
      const pricing = `${origin}/pricing`;
      const careers = `${origin}/careers`;

      // Production: at most one pricing hop, never careers.* (those hosts are very slow on Render).
      if (
        needsPricing &&
        !session.probedOrigins.includes(pricing) &&
        !hasVisitedPage(session, pricing)
      ) {
        session.probedOrigins.push(pricing);
        return {
          type: "navigate",
          url: pricing,
          explanation: "Open pricing on the official site",
        };
      }

      if (!isProd) {
        if (
          !session.probedOrigins.includes(careers) &&
          !hasVisitedPage(session, careers)
        ) {
          session.probedOrigins.push(careers);
          return {
            type: "navigate",
            url: careers,
            explanation: "Open careers on the official site",
          };
        }
      } else if (!session.probedOrigins.includes(careers)) {
        session.probedOrigins.push(careers);
      }
    }
  }
  if (pendingSite && !sameCompanyHost(observation.url, pendingSite)) {
    return {
      type: "navigate",
      url: pendingSite,
      explanation: `Open ${pending}'s official website`,
    };
  }
  const usable = companiesWithOfficialSites(session).filter(
    (c) => c.product || c.pricing || c.targetCustomer
  );
  if (usable.length >= 3 && !nextUnverifiedName(session)) {
    return {
      type: "done",
      summary: "Compiling the comparison from pages already visited.",
    };
  }
  const nextSite = nextOfficialUrl(session, observation.url);
  if (nextSite) {
    return {
      type: "navigate",
      url: nextSite,
      explanation: "Open the next official company website",
    };
  }
  if (usable.length >= 1) {
    return {
      type: "done",
      summary: "Compiling the comparison from official sites already opened.",
    };
  }
  return {
    type: "navigate",
    url: nextWikiSearch(session, observation.url),
    explanation: "No official site left; Wikipedia search is last resort only",
  };
}

async function extractCurrentPage(
  session: SessionState,
  observation: Awaited<ReturnType<typeof observePage>>,
  instruction: string
) {
  if (session.extractedUrls.includes(observation.url)) return;
  if (isBrokenPage(observation) || isMissingWikipediaArticle(observation)) return;
  if (isOffTopicPage(observation, session.goal)) return;
  if (isDeadPage(observation) || isBlockedUrl(observation.url)) return;
  if (isUselessWikiPage(observation)) return;
  // Mark after the attempt so a failed/empty extract can still be retried once the page settles.

  if (observation.url.includes("wikipedia.org")) {
    if (isWikipediaListPage(observation) && session.page) {
      try {
        const wikiNames = await scrapeWikiCompanyNames(session.page);
        const fromWiki = wikiNames
          .filter(
            (name) =>
              !isFamousAiLab(name, session.goal) &&
              !isJunkCompanyName(name) &&
              !isIncumbentVendor(name) &&
              !isOpenSourceErp(name)
          )
          .map((name) => ({
            name,
            sources: [{ title: observation.title, url: observation.url }],
          }));
        session.companies = mergeCompanies(session.companies, fromWiki);
      } catch {
        // keep seeded lookups
      }
    }
    session.extractedUrls.push(observation.url);
    return;
  }

  try {
    const extracted = await extractFromPage({
      goal: session.goal,
      instruction,
      observation,
    });
    const bound = bindExtractToHost(session, observation, extracted.companies);
    session.companies = mergeCompanies(session.companies, bound).filter(
      (c) =>
        !isFamousAiLab(c.name, session.goal) &&
        !isJunkCompanyName(c.name) &&
        !isIncumbentVendor(c.name) &&
        !isOpenSourceErp(c.name)
    );
    session.extractedUrls.push(observation.url);
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
    session.extractedUrls.push(observation.url);
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
  stampSeedWebsite(session, observation.url, observation.title);
  emit(session, {
    type: "page_observed",
    url: observation.url,
    title: observation.title,
    screenshot: observation.screenshot,
    excerpt: observation.excerpt.slice(0, 500),
  });
  if (!observation.screenshot) {
    emit(session, {
      type: "decision",
      message:
        "Page text was captured, but the live screenshot failed on this host. Continuing research from the page content.",
    });
  }
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
  const isProd = process.env.NODE_ENV === "production";
  // Production: one shot for navigations — retries double the Render wait time.
  const maxAttempts =
    isProd && action.type === "navigate" ? 1 : MAX_RETRIES;
  let lastDetail = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await executeAction(page, action);
      if (!result.ok && action.type === "click") {
        return result;
      }
      return result;
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : "Action failed";
      session.retries += 1;
      if (isNetworkFailure(lastDetail)) {
        return { ok: false, detail: lastDetail };
      }

      let strategy = "Retrying the same action";
      if (action.type === "click") {
        const keywords = action.selector
          .replace(/^text=/, "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3);
        const altKeywords = isProd
          ? [...keywords, "pricing", "plans", "about"]
          : [...keywords, "pricing", "plans", "careers", "jobs", "about"];
        const alt = await findAlternativeClickTarget(page, altKeywords);
        if (
          alt &&
          !/accessibility|feedback|cookie/i.test(alt) &&
          !(isProd && /career|job/i.test(alt))
        ) {
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
        await page.waitForTimeout(isProd ? 400 : 1200);
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
    if (/internet|DNS|could not load/i.test(summaryHint)) {
      summary = summaryHint;
    } else if (session.pagesVisited === 0) {
      summary =
        "Research stopped before any page loaded. The automated browser could not reach the web. Confirm internet access, restart the app, then try New research.";
    } else {
      summary =
        "Finished without official-site rows. Wikipedia-only names are not shown — the comparison table only includes companies whose own websites were opened. Run New research and watch the live browser leave Wikipedia for company sites.";
    }
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
