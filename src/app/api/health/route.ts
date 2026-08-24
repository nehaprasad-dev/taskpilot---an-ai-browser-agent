import { NextResponse } from "next/server";
import { hasLlmKey } from "@/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    llmConfigured: hasLlmKey(),
    service: "researchpilot",
  });
}
