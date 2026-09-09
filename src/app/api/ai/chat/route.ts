import { NextRequest, NextResponse } from "next/server";
import {
  buildGroundedContext,
  type AiChatMessage,
  type PageState,
} from "@/lib/ai/jee-advanced-context";
import { buildDataMessage, buildSystemPrompt } from "@/lib/ai/prompt";
import { buildDatabaseAnswer } from "@/lib/ai/answer-fallback";
import { callModel, callNvidiaStream } from "@/lib/ai/model";

export const dynamic = "force-dynamic";

type ChatRequest = {
  exam?: string;
  messages?: AiChatMessage[];
  pageState?: PageState;
  stream?: boolean;
};

function sanitizeMessages(messages: AiChatMessage[]) {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: String(m.content ?? "").slice(0, 3000) }))
    .filter((m) => m.content.trim().length > 0)
    .slice(-8);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ChatRequest | null;
  const messages = sanitizeMessages(body?.messages ?? []);
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content.trim();

  if (!lastUser) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if ((body?.exam ?? "jee-advanced") !== "jee-advanced") {
    return NextResponse.json({ message: "Sorry, can't fetch that info." });
  }

  try {
    const ctx = await buildGroundedContext(lastUser, body?.pageState ?? {}, messages);
    const citations = ctx.facts.map((f) => ({
      ref: f.ref,
      institute: f.institute,
      topic: f.topic,
      claim: f.claim,
      url: f.source_url,
      title: f.source_title,
      publisher: f.publisher,
      publishedAy: f.published_ay,
      coverage: f.coverage,
    }));

    // Streaming path: meta (citations + interpreted filters) first so the
    // client can show progress, then live tokens, then done. Any model
    // failure falls back to the database answer inside the same stream.
    if (body?.stream && process.env.NVIDIA_API_KEY) {
      const encoder = new TextEncoder();
      const system = buildSystemPrompt(ctx);
      const dataMessage = buildDataMessage(ctx);
      const context = {
        rank: ctx.rank,
        seatType: ctx.seatType,
        gender: ctx.gender,
        year: ctx.year,
        round: ctx.round,
        totalMatchingRows: ctx.totalMatchingRows,
      };
      const send = (controller: ReadableStreamDefaultController, event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const stream = new ReadableStream({
        async start(controller) {
          try {
            send(controller, "meta", { citations, context });
            const result = await callNvidiaStream(system, dataMessage, lastUser, (text) =>
              send(controller, "token", { text }),
            );
            if (result.ok) {
              send(controller, "done", { model: result.model });
            } else {
              send(controller, "message", {
                message: buildDatabaseAnswer(ctx),
                model: "database-only-fallback",
                fallbackReason: result.message,
              });
            }
          } catch {
            send(controller, "message", {
              message: buildDatabaseAnswer(ctx),
              model: "database-only-fallback",
            });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const result = await callModel(buildSystemPrompt(ctx), buildDataMessage(ctx), lastUser);
    if (!result) {
      return NextResponse.json({
        message: buildDatabaseAnswer(ctx),
        model: "database-only",
        citations,
        context: {
          rank: ctx.rank,
          seatType: ctx.seatType,
          gender: ctx.gender,
          year: ctx.year,
          round: ctx.round,
          totalMatchingRows: ctx.totalMatchingRows,
        },
      });
    }
    if (!result.ok) {
      return NextResponse.json({
        message: buildDatabaseAnswer(ctx),
        model: "database-only-fallback",
        citations,
        fallbackReason: result.message,
        context: {
          rank: ctx.rank,
          seatType: ctx.seatType,
          gender: ctx.gender,
          year: ctx.year,
          round: ctx.round,
          totalMatchingRows: ctx.totalMatchingRows,
        },
      });
    }
    return NextResponse.json({
      message: result.answer,
      model: result.model,
      citations,
      context: {
        rank: ctx.rank,
        seatType: ctx.seatType,
        gender: ctx.gender,
        year: ctx.year,
        round: ctx.round,
        totalMatchingRows: ctx.totalMatchingRows,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to answer.", message: "Sorry, can't fetch that info." },
      { status: 500 },
    );
  }
}
