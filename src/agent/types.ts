export type PlanStepStatus = "pending" | "active" | "done" | "skipped" | "failed";

export type PlanStep = {
  id: string;
  label: string;
  status: PlanStepStatus;
};

export type AgentAction =
  | { type: "navigate"; url: string; explanation: string }
  | { type: "click"; selector: string; explanation: string }
  | { type: "type"; selector: string; text: string; pressEnter?: boolean; explanation: string }
  | { type: "fill"; selector: string; text: string; pressEnter?: boolean; explanation: string }
  | { type: "scroll"; direction: "up" | "down"; explanation: string }
  | { type: "extract"; instruction: string; explanation: string }
  | { type: "wait"; ms: number; explanation: string }
  | { type: "ask_human"; reason: string; proposedAction?: string }
  | { type: "checkpoint"; summary: string; collected: string[]; missing: string[] }
  | { type: "done"; summary: string };

export type CompanyResearch = {
  name: string;
  website?: string;
  product?: string;
  targetCustomer?: string;
  pricing?: string;
  funding?: string;
  engineeringOpenings?: string;
  sources: { title: string; url: string }[];
  notes?: string;
};

export type ResearchResult = {
  goal: string;
  companies: CompanyResearch[];
  summary: string;
  stats: {
    companiesResearched: number;
    sourcesChecked: number;
    pagesVisited: number;
    retries: number;
  };
};

export type AgentEvent =
  | { type: "session_started"; sessionId: string; goal: string }
  | { type: "plan_created"; steps: PlanStep[] }
  | { type: "plan_updated"; steps: PlanStep[] }
  | { type: "decision"; message: string }
  | { type: "action_started"; action: AgentAction }
  | { type: "action_completed"; action: AgentAction; detail?: string }
  | { type: "page_observed"; url: string; title: string; screenshot: string; excerpt: string }
  | { type: "extraction"; data: unknown; label?: string }
  | { type: "retry"; attempt: number; reason: string; strategy: string }
  | { type: "approval_required"; reason: string; actionPreview?: string }
  | { type: "step_failed"; reason: string; actionLabel: string }
  | { type: "checkpoint"; summary: string; collected: string[]; missing: string[] }
  | { type: "status"; status: AgentStatus; message?: string }
  | { type: "completed"; result: ResearchResult }
  | { type: "error"; message: string; recoverable: boolean };

export type AgentStatus =
  | "idle"
  | "planning"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "awaiting_checkpoint"
  | "awaiting_recovery"
  | "recovering"
  | "completed"
  | "stopped"
  | "error";

export type PageObservation = {
  url: string;
  title: string;
  excerpt: string;
  interactiveElements: { tag: string; text: string; selector: string }[];
  screenshot: string;
};

export type AgentControlCommand =
  | "pause"
  | "resume"
  | "stop"
  | "approve"
  | "reject"
  | "continue_checkpoint"
  | "skip_step"
  | "retry_step"
  | "arm_approve_next";
