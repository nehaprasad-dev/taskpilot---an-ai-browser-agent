import { subscribeToSession, waitForSession } from "@/agent/loop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return new Response("sessionId required", { status: 400 });
  }

  const session = await waitForSession(sessionId);
  if (!session) {
    return new Response(
      JSON.stringify({
        error:
          "Session was not found. Restart `npm run dev` and click New research. Do not refresh mid-run.",
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream already closed
        }
      };

      send({ type: "connected", sessionId });

      cleanup = subscribeToSession(sessionId, (event) => {
        send(event);
        const terminal =
          event.type === "completed" ||
          event.type === "error" ||
          (event.type === "status" &&
            (event.status === "stopped" || event.status === "error"));
        if (terminal) {
          setTimeout(() => {
            try {
              controller.close();
            } catch {
              // already closed
            }
          }, 400);
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      const originalCleanup = cleanup;
      cleanup = () => {
        clearInterval(heartbeat);
        originalCleanup();
      };
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
