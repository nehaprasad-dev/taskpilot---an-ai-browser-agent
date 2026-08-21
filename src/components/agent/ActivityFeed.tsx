"use client";

import type { ActivityItem } from "@/components/agent/useAgentSession";

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <section className="panel activity-panel">
      <header className="panel__header">
        <h2>Agent activity</h2>
      </header>
      {items.length === 0 ? (
        <p className="muted">Actions and decisions will stream here live.</p>
      ) : (
        <ul className="activity-list">
          {items.map((item) => (
            <li key={item.id} className={`activity-item activity-item--${item.kind}`}>
              <div className="activity-item__title">{item.title}</div>
              {item.detail ? (
                <div className="activity-item__detail">{item.detail}</div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
