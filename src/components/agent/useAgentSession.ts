"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  AgentAction,
  AgentControlCommand,
  AgentEvent,
  AgentStatus,
  PlanStep,
  ResearchResult,
} from "@/agent/types";

export type ActivityItem = {
  id: string;
  kind: "decision" | "action" | "retry" | "extraction" | "status" | "error";
  title: string;
  detail?: string;
  ts: number;
};

export type UiState = {
  goal: string;
  sessionId: string | null;
  status: AgentStatus;
  statusMessage?: string;
  plan: PlanStep[];
  activity: ActivityItem[];
  screenshot?: string;
  pageUrl?: string;
  pageTitle?: string;
  pageExcerpt?: string;
  approval?: { reason: string; actionPreview?: string };
  checkpoint?: { summary: string; collected: string[]; missing: string[] };
  recovery?: { reason: string; actionLabel: string };
  result?: ResearchResult;
  error?: string;
};

const initialState: UiState = {
  goal: "",
  sessionId: null,
  status: "idle",
  plan: [],
  activity: [],
};

function actionDetail(action: AgentAction): string {
  if (action.type === "fill" || action.type === "type") {
    return action.explanation || `Filling a field with “${action.text}”`;
  }
  if ("explanation" in action) return action.explanation;
  return action.type;
}

function pushActivity(list: ActivityItem[], item: Omit<ActivityItem, "id" | "ts">) {
  const nextItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    ...item,
  };
  const last = list[0];
  if (last && last.kind === item.kind && last.title === item.title && last.detail === item.detail) {
    return list;
  }
  return [nextItem, ...list].slice(0, 80);
}

export function useAgentSession() {
  const [state, setState] = useState<UiState>(initialState);
  const sourceRef = useRef<EventSource | null>(null);

  const reset = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setState(initialState);
  }, []);

  const handleEvent = useCallback((event: AgentEvent) => {
    setState((prev) => {
      switch (event.type) {
        case "session_started":
          return { ...prev, sessionId: event.sessionId, goal: event.goal };
        case "plan_created":
        case "plan_updated":
          return { ...prev, plan: event.steps };
        case "decision":
          return {
            ...prev,
            activity: pushActivity(prev.activity, {
              kind: "decision",
              title: "Decision",
              detail: event.message,
            }),
          };
        case "action_started":
          return {
            ...prev,
            activity: pushActivity(prev.activity, {
              kind: "action",
              title: `Action · ${event.action.type}`,
              detail: actionDetail(event.action),
            }),
          };
        case "action_completed":
          return {
            ...prev,
            activity: pushActivity(prev.activity, {
              kind: "action",
              title: `Done · ${event.action.type}`,
              detail: event.detail,
            }),
          };
        case "page_observed":
          return {
            ...prev,
            screenshot: event.screenshot || prev.screenshot,
            pageUrl: event.url,
            pageTitle: event.title,
            pageExcerpt: event.excerpt,
          };
        case "extraction":
          return {
            ...prev,
            activity: pushActivity(prev.activity, {
              kind: "extraction",
              title: "Extraction",
              detail: event.label || "Captured structured facts",
            }),
          };
        case "retry":
          return {
            ...prev,
            activity: pushActivity(prev.activity, {
              kind: "retry",
              title: `Retry ${event.attempt}`,
              detail: `${event.reason} → ${event.strategy}`,
            }),
          };
        case "approval_required":
          return {
            ...prev,
            approval: {
              reason: event.reason,
              actionPreview: event.actionPreview,
            },
            status: "awaiting_approval",
          };
        case "checkpoint":
          return {
            ...prev,
            checkpoint: {
              summary: event.summary,
              collected: event.collected,
              missing: event.missing,
            },
            status: "awaiting_checkpoint",
            activity: pushActivity(prev.activity, {
              kind: "status",
              title: "Checkpoint",
              detail: event.summary,
            }),
          };
        case "step_failed":
          return {
            ...prev,
            recovery: {
              reason: event.reason,
              actionLabel: event.actionLabel,
            },
            status: "awaiting_recovery",
            activity: pushActivity(prev.activity, {
              kind: "error",
              title: "Stuck",
              detail: event.reason,
            }),
          };
        case "status": {
          const noisy =
            event.status === "recovering" ||
            event.status === "running" ||
            (event.message || "").includes("Call log");
          return {
            ...prev,
            status: event.status,
            statusMessage: event.message?.split("Call log")[0]?.trim().slice(0, 120),
            approval:
              event.status === "awaiting_approval" ? prev.approval : undefined,
            checkpoint:
              event.status === "awaiting_checkpoint" ? prev.checkpoint : undefined,
            recovery:
              event.status === "awaiting_recovery" ? prev.recovery : undefined,
            activity: noisy || !event.message
              ? prev.activity
              : pushActivity(prev.activity, {
                  kind: "status",
                  title: event.status,
                  detail: event.message.split("Call log")[0]?.trim().slice(0, 180),
                }),
          };
        }
        case "completed":
          return {
            ...prev,
            result: event.result,
            status: "completed",
            approval: undefined,
            checkpoint: undefined,
            recovery: undefined,
          };
        case "error":
          return {
            ...prev,
            error: event.message,
            activity: pushActivity(prev.activity, {
              kind: "error",
              title: "Error",
              detail: event.message.split("Call log")[0]?.trim().slice(0, 180),
            }),
          };
        default:
          return prev;
      }
    });
  }, []);

  const start = useCallback(
    async (goal: string) => {
      sourceRef.current?.close();
      setState({
        ...initialState,
        goal,
        status: "planning",
        statusMessage: "Starting agent…",
      });

      try {
        const res = await fetch("/api/agent/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setState((prev) => ({
            ...prev,
            status: "error",
            error: data.error || `Could not start the agent (${res.status}). Restart npm run dev.`,
          }));
          return;
        }

        const sessionId = data.sessionId as string;
        if (!sessionId) {
          setState((prev) => ({
            ...prev,
            status: "error",
            error: "The server did not return a session id. Restart npm run dev.",
          }));
          return;
        }
        setState((prev) => ({ ...prev, sessionId }));

        const streamRes = await fetch(
          `/api/agent/stream?sessionId=${encodeURIComponent(sessionId)}`,
          { headers: { Accept: "text/event-stream" }, cache: "no-store" }
        );
        if (!streamRes.ok || !streamRes.body) {
          let message = `Live stream failed (${streamRes.status}). Restart npm run dev, then New research.`;
          try {
            const body = await streamRes.json();
            if (body.error) message = body.error;
          } catch {
            // keep default
          }
          setState((prev) => ({
            ...prev,
            status: "error",
            error: message,
            statusMessage: "Could not connect to the agent",
          }));
          return;
        }

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        void (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const chunks = buffer.split("\n\n");
              buffer = chunks.pop() || "";
              for (const chunk of chunks) {
                const line = chunk.split("\n").find((entry) => entry.startsWith("data: "));
                if (!line) continue;
                const event = JSON.parse(line.slice(6)) as
                  | AgentEvent
                  | { type: "connected" };
                if (event.type === "connected") continue;
                handleEvent(event as AgentEvent);
                const terminal =
                  event.type === "completed" ||
                  event.type === "error" ||
                  (event.type === "status" &&
                    (event.status === "stopped" || event.status === "error"));
                if (terminal) {
                  await reader.cancel().catch(() => undefined);
                  return;
                }
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "Stream closed";
            if (/abort/i.test(message)) return;
            setState((prev) => {
              if (prev.status === "completed" || prev.status === "stopped") return prev;
              return {
                ...prev,
                status: "error",
                error: "Lost the live agent stream. Click New research.",
              };
            });
          }
        })();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to start";
        setState((prev) => ({
          ...prev,
          status: "error",
          error: message,
        }));
      }
    },
    [handleEvent]
  );

  const control = useCallback(
    async (command: AgentControlCommand) => {
      if (!state.sessionId) return;
      const response = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, command }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setState((prev) => ({
          ...prev,
          error: body.error || `Control request failed (${response.status})`,
        }));
        return;
      }
      if (command === "approve" || command === "reject") {
        setState((prev) => ({ ...prev, approval: undefined }));
      }
      if (command === "continue_checkpoint") {
        setState((prev) => ({ ...prev, checkpoint: undefined }));
      }
      if (command === "retry_step" || command === "skip_step") {
        setState((prev) => ({ ...prev, recovery: undefined }));
      }
    },
    [state.sessionId]
  );

  const isLive = useMemo(
    () =>
      [
        "planning",
        "running",
        "paused",
        "awaiting_approval",
        "awaiting_checkpoint",
        "awaiting_recovery",
        "recovering",
      ].includes(state.status),
    [state.status]
  );

  return { state, start, control, reset, isLive };
}
