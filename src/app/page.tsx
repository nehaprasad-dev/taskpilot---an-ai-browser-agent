"use client";

import { AgentInput } from "@/components/agent/AgentInput";
import { PlanPanel } from "@/components/agent/PlanPanel";
import { ActivityFeed } from "@/components/agent/ActivityFeed";
import { BrowserPreview } from "@/components/agent/BrowserPreview";
import { ControlBar } from "@/components/agent/ControlBar";
import { ApprovalCard } from "@/components/agent/ApprovalCard";
import { CheckpointCard } from "@/components/agent/CheckpointCard";
import { ResearchTable } from "@/components/results/ResearchTable";
import { useAgentSession } from "@/components/agent/useAgentSession";

export default function HomePage() {
  const { state, start, control, reset, isLive } = useAgentSession();
  const showControlRoom = state.status !== "idle";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark" aria-hidden />
          <span>ResearchPilot</span>
        </div>
        <div className={`topbar__status topbar__status--${state.status}`}>
          <span className="topbar__dot" />
          {state.statusMessage || state.status}
        </div>
      </header>

      {!showControlRoom ? (
        <AgentInput onStart={start} />
      ) : (
        <div className="control-room">
          <div className="control-room__goal">
            <p className="eyebrow">Active goal</p>
            <p>{state.goal}</p>
            {state.error ? <p className="error-banner">{state.error}</p> : null}
          </div>

          <div className="control-room__grid">
            <PlanPanel steps={state.plan} />
            <BrowserPreview
              screenshot={state.screenshot}
              url={state.pageUrl}
              title={state.pageTitle}
            />
          </div>

          <ActivityFeed items={state.activity} />

          {state.result ? <ResearchTable result={state.result} /> : null}

          {(state.approval || state.checkpoint) && (
            <div className="overlay">
              {state.approval ? (
                <ApprovalCard
                  reason={state.approval.reason}
                  actionPreview={state.approval.actionPreview}
                  onApprove={() => control("approve")}
                  onReject={() => control("reject")}
                />
              ) : null}
              {state.checkpoint ? (
                <CheckpointCard
                  summary={state.checkpoint.summary}
                  collected={state.checkpoint.collected}
                  missing={state.checkpoint.missing}
                  onContinue={() => control("continue_checkpoint")}
                  onStop={() => control("stop")}
                />
              ) : null}
            </div>
          )}

          <ControlBar
            status={state.status}
            isLive={isLive}
            onPause={() => control("pause")}
            onResume={() => control("resume")}
            onStop={() => control("stop")}
            onReset={reset}
          />
        </div>
      )}
    </main>
  );
}
