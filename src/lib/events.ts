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
    return this.history.map((event) => {
      if (event.type === "page_observed") {
        return { ...event, screenshot: "" };
      }
      return event;
    });
  }
}
