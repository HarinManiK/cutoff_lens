import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  buildGroundedContext,
  type GroundedContext,
  type PageState,
} from "@/lib/ai/jee-advanced-context";
import { buildDataMessage, buildSystemPrompt } from "@/lib/ai/prompt";
import { buildDatabaseAnswer } from "@/lib/ai/answer-fallback";
import { isAiConfigured, streamModel, type ChatTurn, type StreamResult } from "@/lib/ai/model";

export const dynamic = "force-dynamic";
// Reasoning models spend real time before the first token; the platform default
// would cut a good answer off mid-stream.
export const maxDuration = 60;

const MAX_MESSAGE_CHARS = 2_000;
const MAX_TURNS = 10;

const chatRequestSchema = z.object({
  exam: z.string().max(64).optional(),
  stream: z.boolean().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .max(60),
  pageState: z
    .object({
      rank: z.string().max(20).optional(),
      seatType: z.string().max(40).optional(),
      gender: z.enum(["Male", "Female"]).optional(),
      year: z.string().max(8).optional(),
      round: z.string().max(4).optional(),
      selectedInstitutes: z.array(z.string().max(120)).max(60).optional(),
      selectedPrograms: z.array(z.string().max(200)).max(400).optional(),
      selectedDegrees: z.array(z.string().max(80)).max(40).optional(),
      selectedDurations: z.array(z.string().max(40)).max(20).optional(),
      selectedProgramTypes: z.array(z.string().max(60)).max(20).optional(),
    })
    .optional(),
});

// Best-effort throttle. Serverless instances do not share memory, so this
// blunts accidental loops and casual abuse rather than acting as a real quota;
// the model spend it protects is small but not free.
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 12 };
const hits = new Map<string, number[]>();

function rateLimited(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((at) => now - at < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) hits.clear();
  return recent.length > RATE_LIMIT.maxRequests;
}

function clientKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "anonymous";
}

function sanitizeTurns(messages: ChatTurn[]): ChatTurn[] {
  return messages
    .map((message) => ({ role: message.role, content: String(message.content ?? "").trim().slice(0, MAX_MESSAGE_CHARS) }))
    .filter((message) => message.content.length > 0)
    .slice(-MAX_TURNS);
}

function answerContext(ctx: GroundedContext) {
  return {
    rank: ctx.rank,
    seatType: ctx.seatType,
    gender: ctx.gender,
    year: ctx.year,
    round: ctx.round,
    intent: ctx.intent,
    filters: ctx.filterSummary,
    totalInReach: ctx.coverage.totalInReach,
    shown: ctx.coverage.included,
    institutesIncluded: ctx.coverage.institutesIncluded,
    institutesAvailable: ctx.coverage.institutesAvailable,
    // Turns that ask a question rather than answer one carry no evidence, and
    // the UI should not badge them with a data summary.
    hasEvidence: ctx.includedRows.length > 0 || ctx.facts.length > 0,
  };
}

function citationsOf(ctx: GroundedContext) {
  return ctx.facts.map((fact) => ({
    ref: fact.ref,
    institute: fact.institute,
    topic: fact.topic,
    claim: fact.claim,
    url: fact.source_url,
    title: fact.source_title,
    publisher: fact.publisher,
    publishedAy: fact.published_ay,
    coverage: fact.coverage,
  }));
}

function fallbackNotice(result: Extract<StreamResult, { ok: false }>) {
  return `${result.message}, so this is the database answer.`;
}

// ── TEMPORARY DEMO HACK — REVERT AFTER RECORDING ──────────────────────────
// Exact-match scripted answer for the demo video. Matches one sentence plus
// the filter state set for the recording, sleeps 3s to mimic thinking, then
// prints the canned picks below. Nothing else routes through here.
// Revert with: git revert <this commit>
const DEMO_TRIGGER =
  "based on my rank whats the top 5 picks for me i prefer only btech degree";

const DEMO_ANSWER = [
  "Based on your rank of 2,700 (SC, Female-only seats, JoSAA 2026 Round 5), here are your top 5 picks for a BTech degree:",
  "",
  "1. IIT Madras — Biological Science (B.S.) — closing 3,309",
  "2. IIT Delhi — Energy Engineering (B.Tech) — closing 2,829",
  "3. IIT Delhi — Textile Technology (B.Tech) — closing 3,546",
  "4. IIT Delhi — Design (B.Tech) — closing 4,442",
  "5. IIT Kanpur — Civil Engineering (B.Tech) — closing 3,122",
  "",
  "These are official 2026 Round 5 closing ranks that were within reach of rank 2,700 — a better guess, not a prediction.",
].join("\n");

function isDemoRequest(lastUser: string, pageState: PageState | undefined) {
  const normalized = lastUser
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    normalized === DEMO_TRIGGER &&
    (pageState?.rank ?? "").trim() === "2700" &&
    (pageState?.seatType ?? "") === "SC" &&
    (pageState?.gender ?? "") === "Female"
  );
}
// ── END TEMPORARY DEMO HACK ───────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const body = parsed.data;

  const turns = sanitizeTurns(body.messages);
  const lastUser = [...turns].reverse().find((turn) => turn.role === "user")?.content;
  if (!lastUser) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if ((body.exam ?? "jee-advanced") !== "jee-advanced") {
    return NextResponse.json({ error: "Unsupported exam." }, { status: 400 });
  }
  if (rateLimited(clientKey(request))) {
    return NextResponse.json(
      { error: "Too many questions in a row. Give it a minute and try again." },
      { status: 429 },
    );
  }

  let ctx: GroundedContext;
  try {
    ctx = await buildGroundedContext(lastUser, (body.pageState ?? {}) as PageState, turns);
  } catch (error) {
    // The message is for the server log; the client gets nothing internal.
    console.error("ai/chat: grounding failed", error);
    return NextResponse.json(
      { error: "Could not read the cutoff data for that question." },
      { status: 500 },
    );
  }

  const citations = citationsOf(ctx);
  const context = answerContext(ctx);

  // ── TEMPORARY DEMO HACK — REVERT AFTER RECORDING ──
  if (isDemoRequest(lastUser, body.pageState as PageState | undefined)) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (body.stream) {
      const encoder = new TextEncoder();
      const demoStream = new ReadableStream({
        start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          send("meta", { citations, context });
          send("token", { text: DEMO_ANSWER });
          send("done", { source: "model", model: "demo-scripted" });
          controller.close();
        },
      });
      return new Response(demoStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
    return NextResponse.json({
      message: DEMO_ANSWER,
      source: "model",
      model: "demo-scripted",
      notice: null,
      citations,
      context,
    });
  }
  // ── END TEMPORARY DEMO HACK ──

  const modelRequest = {
    system: buildSystemPrompt(ctx),
    dataMessage: buildDataMessage(ctx),
    history: turns,
    latestUserMessage: lastUser,
  };

  // With no provider configured the deterministic answer is the product, not a
  // degraded mode, so it is labelled honestly rather than dressed up as the AI.
  if (!isAiConfigured()) {
    return NextResponse.json({
      message: buildDatabaseAnswer(ctx),
      source: "database",
      notice: null,
      citations,
      context,
    });
  }

  if (body.stream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        try {
          send("meta", { citations, context });
          let emitted = false;
          const result = await streamModel(modelRequest, (text) => {
            emitted = true;
            send("token", { text });
          });
          if (result.ok) {
            send("done", { source: "model", model: result.model });
          } else if (emitted) {
            // Partial answer already on screen: keep it, but say it is cut off
            // rather than pretending it finished.
            send("done", {
              source: "model",
              notice: "The answer was cut off before it finished. Ask again to retry.",
            });
          } else {
            send("replace", {
              message: buildDatabaseAnswer(ctx),
              source: "database",
              notice: fallbackNotice(result),
            });
          }
        } catch (error) {
          console.error("ai/chat: stream failed", error);
          send("replace", {
            message: buildDatabaseAnswer(ctx),
            source: "database",
            notice: "The AI model did not respond, so this is the database answer.",
          });
        } finally {
          closed = true;
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const result = await streamModel(modelRequest, () => {});
  if (!result.ok) {
    return NextResponse.json({
      message: buildDatabaseAnswer(ctx),
      source: "database",
      notice: fallbackNotice(result),
      citations,
      context,
    });
  }
  return NextResponse.json({
    message: result.text,
    source: "model",
    model: result.model,
    notice: null,
    citations,
    context,
  });
}
