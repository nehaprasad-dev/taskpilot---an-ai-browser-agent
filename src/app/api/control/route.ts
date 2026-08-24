import { NextResponse } from "next/server";
import { sendControl } from "@/agent/loop";
import type { AgentControlCommand } from "@/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMANDS = new Set<AgentControlCommand>([
  "pause",
  "resume",
  "stop",
  "approve",
  "reject",
  "continue_checkpoint",
  "skip_step",
  "retry_step",
  "arm_approve_next",
]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      command?: AgentControlCommand;
    };

    if (!body.sessionId || !body.command) {
      return NextResponse.json(
        { error: "sessionId and command are required" },
        { status: 400 }
      );
    }
    if (!COMMANDS.has(body.command)) {
      return NextResponse.json({ error: "Invalid control command" }, { status: 400 });
    }

    const result = sendControl(body.sessionId, body.command);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Control failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
