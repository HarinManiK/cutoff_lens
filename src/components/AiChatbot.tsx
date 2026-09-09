"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import type { PageState } from "@/lib/ai/jee-advanced-context";

type Citation = {
  ref: number;
  institute: string;
  topic: string;
  claim: string;
  url: string;
  title: string;
  publisher: string;
  publishedAy: string;
  coverage: string;
};

type AnswerContext = {
  rank: number | null;
  seatType: string;
  gender: string;
  year: number;
  round: number;
  totalMatchingRows: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  context?: AnswerContext;
  model?: string;
};

type Stage = "idle" | "reading" | "matching" | "writing";

const STAGE_LABEL: Record<Exclude<Stage, "idle">, string> = {
  reading: "Reading your filters",
  matching: "Matching JoSAA cutoffs",
  writing: "Writing answer",
};

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={`${keyPrefix}-${i}`}>{bold[1]}</strong>;
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  function flushList(key: string) {
    if (!list) return;
    const { ordered, items } = list;
    list = null;
    blocks.push(
      ordered ? (
        <ol key={key}>{items.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}`)}</li>)}</ol>
      ) : (
        <ul key={key}>{items.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}`)}</li>)}</ul>
      ),
    );
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    const ordered = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    const heading = trimmed.match(/^#{1,4}\s+(.*)$/);
    if (ordered) {
      if (!list || !list.ordered) {
        flushList(`l-${i}`);
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[2]);
    } else if (bullet) {
      if (!list || list.ordered) {
        flushList(`l-${i}`);
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
    } else {
      flushList(`l-${i}`);
      if (!trimmed) return;
      if (heading) {
        blocks.push(<p key={i} className="ai-md-head">{renderInline(heading[1], `h-${i}`)}</p>);
      } else {
        blocks.push(<p key={i}>{renderInline(line, `p-${i}`)}</p>);
      }
    }
  });
  flushList("l-end");
  return blocks;
}

function ContextChips({ context }: { context: AnswerContext }) {
  const chips: string[] = [];
  if (context.rank) chips.push(`Rank ${context.rank.toLocaleString("en-IN")}`);
  chips.push(context.seatType);
  chips.push(context.gender === "Female" ? "Female-only" : "Gender-Neutral");
  chips.push(`${context.year} R${context.round}`);
  return (
    <div className="ai-context-chips" aria-label="Answer context">
      {chips.map((chip) => (
        <span key={chip} className="ai-context-chip">{chip}</span>
      ))}
    </div>
  );
}

export function AiChatbot({ pageState }: { pageState: PageState }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [streamingText, setStreamingText] = useState("");
  const [streamContext, setStreamContext] = useState<AnswerContext | undefined>(undefined);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loading = stage !== "idle";

  useEffect(() => {
    const box = messagesRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, streamingText, stage, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setStage("reading");
    setStreamingText("");
    setStreamContext(undefined);

    async function finishAsJson() {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exam: "jee-advanced",
          messages: next.map(({ role, content }) => ({ role, content })),
          pageState,
        }),
        signal: controller.signal,
      });
      const body = (await response.json()) as {
        message?: string;
        citations?: Citation[];
        context?: AnswerContext;
        model?: string;
      };
      setMessages([
        ...next,
        {
          role: "assistant",
          content: body.message ?? "Sorry, can't fetch that info.",
          citations: body.citations ?? [],
          context: body.context,
          model: body.model,
        },
      ]);
      setStage("idle");
    }

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exam: "jee-advanced",
          messages: next.map(({ role, content }) => ({ role, content })),
          pageState,
          stream: true,
        }),
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("text/event-stream") || !response.body) {
        await finishAsJson();
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      let citations: Citation[] = [];
      let context: AnswerContext | undefined;
      let model: string | undefined;
      let sawToken = false;

      function handleEvent(event: string, raw: string) {
        let data: {
          text?: string;
          citations?: Citation[];
          context?: AnswerContext;
          message?: string;
          model?: string;
        };
        try {
          data = JSON.parse(raw) as typeof data;
        } catch {
          return;
        }
        if (event === "meta") {
          citations = data.citations ?? [];
          context = data.context;
          setStreamContext(context);
          setStage("matching");
        } else if (event === "token") {
          sawToken = true;
          acc += data.text ?? "";
          setStreamingText(acc);
          setStage("writing");
        } else if (event === "message") {
          acc = data.message ?? "Sorry, can't fetch that info.";
          model = data.model;
          setStreamingText(acc);
        } else if (event === "done") {
          model = data.model;
        }
      }

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          let event = "";
          const payloads: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) payloads.push(line.slice(5).trim());
          }
          if (event && payloads.length > 0) handleEvent(event, payloads.join("\n"));
        }
      }
      if (!sawToken && !acc) {
        await finishAsJson();
        return;
      }
      setMessages([...next, { role: "assistant", content: acc, citations, context, model }]);
      setStreamingText("");
      setStage("idle");
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setStage("idle");
        return;
      }
      try {
        await finishAsJson();
      } catch {
        setMessages([...next, { role: "assistant", content: "Sorry, can't fetch that info." }]);
        setStage("idle");
      }
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close AI counsellor" : "Open AI counsellor"}
        className="ai-chat-fab"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
        {!open ? <span className="ai-chat-fab__label">Ask AI</span> : null}
      </button>
      {open ? (
        <section className="ai-chat-panel" aria-label="AI counsellor">
          <header className="ai-chat-head">
            <span className={loading ? "ai-status-dot is-busy" : "ai-status-dot"} aria-hidden="true" />
            <div>
              <b>Cutoff Lens AI</b>
              <span>{loading ? `${STAGE_LABEL[stage as Exclude<Stage, "idle">]}…` : "Grounded in JoSAA data · better guess, not a prediction"}</span>
            </div>
          </header>
          <div className="ai-chat-messages" ref={messagesRef}>
            {messages.length === 0 && !loading ? (
              <div className="ai-chat-empty">
                <p>Ask about your rank, branches, placements, fees…</p>
                <p className="muted">e.g. “SC 2807, best B.Tech picks in 2026 R5?”</p>
              </div>
            ) : null}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "ai-msg ai-msg--user" : "ai-msg ai-msg--ai"}>
                {m.role === "assistant" && m.context ? <ContextChips context={m.context} /> : null}
                <div className="ai-msg__body">{m.role === "assistant" ? renderMarkdown(m.content) : <p>{m.content}</p>}</div>
                {m.citations && m.citations.length > 0 ? (
                  <div className="ai-citations">
                    {m.citations.slice(0, 6).map((c) => (
                      <a key={c.ref} href={c.url} target="_blank" rel="noreferrer" className="ai-cite-chip" title={`${c.claim} (${c.coverage})`}>
                        [{c.ref}] {c.institute} · {c.topic}{c.publishedAy ? ` · ${c.publishedAy}` : ""} · {c.coverage}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {loading ? (
              <div className="ai-msg ai-msg--ai ai-msg--thinking">
                {streamingText ? (
                  <div className="ai-msg__body">{renderMarkdown(streamingText)}</div>
                ) : (
                  <p className="ai-thinking">
                    <Loader2 className="ai-spin" size={14} />
                    {STAGE_LABEL[stage as Exclude<Stage, "idle">]}…
                  </p>
                )}
                {streamContext ? <ContextChips context={streamContext} /> : null}
              </div>
            ) : null}
          </div>
          <div className="ai-chat-input">
            <input
              placeholder="Ask about ranks, branches, placements, fees…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
            />
            <button type="button" aria-label="Send" onClick={send} disabled={loading}>
              {loading ? <Loader2 className="ai-spin" size={16} /> : <Send size={16} />}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
