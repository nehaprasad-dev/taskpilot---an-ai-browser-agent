"use client";

import type { PlanStep } from "@/agent/types";

const STATUS_GLYPH: Record<PlanStep["status"], string> = {
  done: "✓",
  active: "→",
  pending: "○",
  skipped: "–",
  failed: "!",
};

export function PlanPanel({ steps }: { steps: PlanStep[] }) {
  return (
    <section className="panel plan-panel">
      <header className="panel__header">
        <h2>Plan</h2>
      </header>
      {steps.length === 0 ? (
        <p className="muted">Waiting for the agent to draft a plan…</p>
      ) : (
        <ol className="plan-list">
          {steps.map((step) => (
            <li key={step.id} className={`plan-item plan-item--${step.status}`}>
              <span className="plan-item__glyph" aria-hidden>
                {STATUS_GLYPH[step.status]}
              </span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
