import type { AgentEvent } from "@/agent/types";

export type EventListener = (event: AgentEvent) => void;

export class EventBus {
  private listeners = new Set<EventListener>();
  private history: AgentEvent[] = [];

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AgentEvent) {
    this.history.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors so the agent keeps running.
      }
    }
  }

  getHistory(): AgentEvent[] {
    const lastWithShot = [...this.history]
      .reverse()
      .find((event) => event.type === "page_observed" && event.screenshot);
    return this.history.map((event) => {
      if (event.type !== "page_observed") return event;
      if (lastWithShot && event === lastWithShot) return event;
      return { ...event, screenshot: "" };
    });
  }
}
