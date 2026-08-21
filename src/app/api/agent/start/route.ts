import { NextResponse } from "next/server";
import { startAgentSession } from "@/agent/loop";
import { hasLlmKey } from "@/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { goal?: string };
    const goal = body.goal?.trim();
    if (!goal) {
      return NextResponse.json({ error: "Goal is required" }, { status: 400 });
    }
    if (!hasLlmKey()) {
      return NextResponse.json(
        {
          error:
            "Missing GROQ_API_KEY. Add it to .env, then restart the server.",
        },
        { status: 500 }
      );
    }

    const { sessionId } = await startAgentSession(goal);
    return NextResponse.json({ sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
