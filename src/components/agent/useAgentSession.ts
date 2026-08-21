"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
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
  approval?: { reason: string; actionPreview?: string };
  checkpoint?: { summary: string; collected: string[]; missing: string[] };
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
              detail:
                "explanation" in event.action
                  ? event.action.explanation
                  : JSON.stringify(event.action),
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
            screenshot: event.screenshot,
            pageUrl: event.url,
            pageTitle: event.title,
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
          };
        case "status":
          return {
            ...prev,
            status: event.status,
            statusMessage: event.message,
            approval:
              event.status === "awaiting_approval" ? prev.approval : undefined,
            checkpoint:
              event.status === "awaiting_checkpoint" ? prev.checkpoint : undefined,
            activity: event.message
              ? pushActivity(prev.activity, {
                  kind: "status",
                  title: event.status,
                  detail: event.message,
                })
              : prev.activity,
          };
        case "completed":
          return {
            ...prev,
            result: event.result,
            status: "completed",
            approval: undefined,
            checkpoint: undefined,
          };
        case "error":
          return {
            ...prev,
            error: event.message,
            activity: pushActivity(prev.activity, {
              kind: "error",
              title: "Error",
              detail: event.message,
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

      const res = await fetch("/api/agent/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState((prev) => ({
          ...prev,
          status: "error",
          error: data.error || "Failed to start",
        }));
        return;
      }

      const sessionId = data.sessionId as string;
      setState((prev) => ({ ...prev, sessionId }));

      const source = new EventSource(
        `/api/agent/stream?sessionId=${encodeURIComponent(sessionId)}`
      );
      sourceRef.current = source;
      let reachedTerminal = false;
      const closeStream = () => {
        source.close();
        if (sourceRef.current === source) sourceRef.current = null;
      };

      source.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as AgentEvent | { type: "connected" };
          if (event.type === "connected") return;
          handleEvent(event as AgentEvent);
          const terminal =
            event.type === "completed" ||
            event.type === "error" ||
            (event.type === "status" &&
              (event.status === "stopped" || event.status === "error"));
          if (terminal) {
            reachedTerminal = true;
            closeStream();
          }
        } catch {
          // ignore malformed chunks
        }
      };
      source.onerror = () => {
        if (reachedTerminal) closeStream();
      };
    },
    [handleEvent]
  );

  const control = useCallback(
    async (
      command:
        | "pause"
        | "resume"
        | "stop"
        | "approve"
        | "reject"
        | "continue_checkpoint"
        | "skip_step"
    ) => {
      if (!state.sessionId) return;
      await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId, command }),
      });
      if (command === "approve" || command === "reject") {
        setState((prev) => ({ ...prev, approval: undefined }));
      }
      if (command === "continue_checkpoint") {
        setState((prev) => ({ ...prev, checkpoint: undefined }));
      }
    },
    [state.sessionId]
  );

  const isLive = useMemo(
    () =>
      ["planning", "running", "paused", "awaiting_approval", "awaiting_checkpoint", "recovering"].includes(
        state.status
      ),
    [state.status]
  );

  return { state, start, control, reset, isLive };
}
