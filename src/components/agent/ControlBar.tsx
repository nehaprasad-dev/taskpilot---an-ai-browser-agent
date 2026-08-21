"use client";

import type { AgentStatus } from "@/agent/types";

type Props = {
  status: AgentStatus;
  isLive: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onReset: () => void;
};

const LABELS: Record<AgentStatus, string> = {
  idle: "Idle",
  planning: "Planning",
  running: "Agent running",
  paused: "Paused",
  awaiting_approval: "Needs approval",
  awaiting_checkpoint: "Checkpoint",
  recovering: "Recovering",
  completed: "Completed",
  stopped: "Stopped",
  error: "Error",
};

export function ControlBar({
  status,
  isLive,
  onPause,
  onResume,
  onStop,
  onReset,
}: Props) {
  return (
    <footer className="control-bar">
      <div className={`status-pill status-pill--${status}`}>
        <span className="status-pill__dot" />
        {LABELS[status]}
      </div>
      <div className="control-bar__actions">
        {status === "paused" ? (
          <button type="button" className="btn" onClick={onResume}>
            Resume
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={onPause}
            disabled={!isLive || status === "awaiting_approval"}
          >
            Pause
          </button>
        )}
        <button
          type="button"
          className="btn btn-danger"
          onClick={onStop}
          disabled={!isLive && status !== "paused"}
        >
          Stop
        </button>
        {(status === "completed" || status === "stopped" || status === "error") && (
          <button type="button" className="btn btn-primary" onClick={onReset}>
            New research
          </button>
        )}
      </div>
    </footer>
  );
}
