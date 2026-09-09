"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, RotateCcw, Send, Square, X } from "lucide-react";
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
  intent: string;
  filters: string | null;
  totalInReach: number;
  shown: number;
  institutesIncluded: number;
  institutesAvailable: number;
  hasEvidence: boolean;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  context?: AnswerContext;
  source?: "model" | "database";
  notice?: string | null;
  error?: boolean;
};

type Stage = "idle" | "reading" | "matching" | "writing";

const STAGE_LABEL: Record<Exclude<Stage, "idle">, string> = {
  reading: "Reading your question",
  matching: "Matching JoSAA cutoffs",
  writing: "Writing answer",
};

const STARTERS = [
  "SC 2807, female — best B.Tech picks?",
  "Rank 4000 OPEN male, circuit branches only",
  "How are placements at IIT Goa?",
];

// --- Markdown ---------------------------------------------------------------
// Hand-rolled to stay dependency-free, but wide enough for what the model
// actually emits. The previous renderer knew only bold and lists, so a table
// or a link arrived as raw pipes and brackets in the middle of an answer.

function renderInline(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]"));
      nodes.push(
        <a key={key} href={match[2]} target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line: string) {
  return /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.includes("-");
}

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = (key: string) => {
    if (!list) return;
    const { ordered, items } = list;
    list = null;
    const rendered = items.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}`)}</li>);
    blocks.push(ordered ? <ol key={key}>{rendered}</ol> : <ul key={key}>{rendered}</ul>);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // Table: a header row followed by a --- divider.
    if (trimmed.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushList(`l-${i}`);
      const head = splitTableRow(trimmed);
      const body: string[][] = [];
      let cursor = i + 2;
      while (cursor < lines.length && lines[cursor].includes("|")) {
        body.push(splitTableRow(lines[cursor]));
        cursor += 1;
      }
      blocks.push(
        <div className="ai-table-scroll" key={`t-${i}`}>
          <table>
            <thead>
              <tr>{head.map((cell, c) => <th key={c}>{renderInline(cell, `th-${i}-${c}`)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c}>{renderInline(cell, `td-${i}-${r}-${c}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      i = cursor - 1;
      continue;
    }

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
      if (!trimmed) continue;
      if (heading) {
        blocks.push(<p key={i} className="ai-md-head">{renderInline(heading[1], `h-${i}`)}</p>);
      } else {
        blocks.push(<p key={i}>{renderInline(line, `p-${i}`)}</p>);
      }
    }
  }
  flushList("l-end");
  return blocks;
}

// --- Pieces -----------------------------------------------------------------

function ContextChips({ context }: { context: AnswerContext }) {
  if (!context.hasEvidence) return null;
  const chips: string[] = [];
  if (context.rank) chips.push(`Rank ${context.rank.toLocaleString("en-IN")}`);
  chips.push(context.seatType);
  chips.push(context.gender === "Female" ? "Female-only" : "Gender-Neutral");
  chips.push(`${context.year} R${context.round}`);
  if (context.filters) chips.push(context.filters);
  if (context.totalInReach > 0) {
    chips.push(
      context.shown < context.totalInReach
        ? `${context.shown} of ${context.totalInReach} in reach`
        : `${context.totalInReach} in reach`,
    );
  }
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
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pageStateRef = useRef(pageState);

  pageStateRef.current = pageState;
  const loading = stage !== "idle";

  useEffect(() => {
    const box = messagesRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, streamingText, stage, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(async (history: ChatMessage[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStage("reading");
    setStreamingText("");
    setStreamContext(undefined);

    const payload = {
      exam: "jee-advanced",
      messages: history.map(({ role, content }) => ({ role, content })),
      pageState: pageStateRef.current,
    };

    const finishAsJson = async () => {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = (await response.json()) as {
        message?: string;
        error?: string;
        citations?: Citation[];
        context?: AnswerContext;
        source?: "model" | "database";
        notice?: string | null;
      };
      setMessages([
        ...history,
        body.message
          ? {
              role: "assistant",
              content: body.message,
              citations: body.citations ?? [],
              context: body.context,
              source: body.source,
              notice: body.notice ?? null,
            }
          : {
              role: "assistant",
              content: body.error ?? "Something went wrong on my side. Try that again.",
              error: true,
            },
      ]);
      setStage("idle");
    };

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, stream: true }),
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
      let source: "model" | "database" | undefined;
      let notice: string | null = null;

      const handleEvent = (event: string, raw: string) => {
        let data: {
          text?: string;
          citations?: Citation[];
          context?: AnswerContext;
          message?: string;
          source?: "model" | "database";
          notice?: string | null;
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
          acc += data.text ?? "";
          setStreamingText(acc);
          setStage("writing");
        } else if (event === "replace") {
          // The model failed. The database answer takes over, and the notice
          // says so rather than passing it off as the AI's work.
          acc = data.message ?? "";
          source = data.source ?? "database";
          notice = data.notice ?? null;
          setStreamingText(acc);
        } else if (event === "done") {
          source = data.source ?? "model";
          notice = data.notice ?? null;
        }
      };

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

      if (!acc.trim()) {
        await finishAsJson();
        return;
      }
      setMessages([...history, { role: "assistant", content: acc, citations, context, source, notice }]);
      setStreamingText("");
      setStage("idle");
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // Keep whatever streamed in before the stop, so the click is not
        // punished by losing the partial answer.
        if (streamingText.trim()) {
          setMessages([
            ...history,
            { role: "assistant", content: streamingText, notice: "Stopped before the answer finished." },
          ]);
        }
        setStreamingText("");
        setStage("idle");
        return;
      }
      try {
        await finishAsJson();
      } catch {
        setMessages([
          ...history,
          { role: "assistant", content: "I could not reach the server. Check your connection and try again.", error: true },
        ]);
        setStage("idle");
      }
    }
  }, [streamingText]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "";
      void ask([...messages, { role: "user", content: trimmed }]);
    },
    [ask, loading, messages],
  );

  const retry = useCallback(() => {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    const upToLastUser = messages.slice(0, messages.lastIndexOf(lastUser) + 1);
    setMessages(upToLastUser);
    void ask(upToLastUser);
  }, [ask, messages]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant";

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close AI counsellor" : "Open AI counsellor"}
        className="ai-chat-fab"
        onClick={() => setOpen((value) => !value)}
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
              <span>
                {loading
                  ? `${STAGE_LABEL[stage as Exclude<Stage, "idle">]}…`
                  : "Grounded in JoSAA data · a better guess, not a prediction"}
              </span>
            </div>
          </header>

          <div className="ai-chat-messages" ref={messagesRef}>
            {messages.length === 0 && !loading ? (
              <div className="ai-chat-empty">
                <p>Ask about your rank, branches, placements or fees.</p>
                <div className="ai-starters">
                  {STARTERS.map((starter) => (
                    <button key={starter} type="button" onClick={() => send(starter)}>
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((message, index) => (
              <div
                key={index}
                className={message.role === "user" ? "ai-msg ai-msg--user" : "ai-msg ai-msg--ai"}
              >
                {message.role === "assistant" && message.context ? <ContextChips context={message.context} /> : null}
                <div className="ai-msg__body">
                  {message.role === "assistant" ? renderMarkdown(message.content) : <p>{message.content}</p>}
                </div>
                {message.notice ? <p className="ai-notice">{message.notice}</p> : null}
                {message.citations && message.citations.length > 0 ? (
                  <div className="ai-citations">
                    {message.citations.slice(0, 6).map((citation) => (
                      <a
                        key={citation.ref}
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className="ai-cite-chip"
                        title={`${citation.claim} (${citation.coverage})`}
                      >
                        [{citation.ref}] {citation.institute} · {citation.topic}
                        {citation.publishedAy ? ` · ${citation.publishedAy}` : ""}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {loading ? (
              <div className="ai-msg ai-msg--ai ai-msg--thinking" aria-live="polite" aria-atomic="false">
                {streamContext ? <ContextChips context={streamContext} /> : null}
                {streamingText ? (
                  <div className="ai-msg__body">{renderMarkdown(streamingText)}</div>
                ) : (
                  <p className="ai-thinking">
                    <Loader2 className="ai-spin" size={14} />
                    {STAGE_LABEL[stage as Exclude<Stage, "idle">]}…
                  </p>
                )}
              </div>
            ) : null}

            {!loading && lastIsAssistant ? (
              <button type="button" className="ai-retry" onClick={retry}>
                <RotateCcw size={12} /> Ask again
              </button>
            ) : null}
          </div>

          <div className="ai-chat-input">
            <textarea
              ref={inputRef}
              rows={1}
              placeholder="Ask about ranks, branches or placements…"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                // Grow with the question instead of hiding it behind a
                // one-line scroll box.
                const field = event.target;
                field.style.height = "auto";
                field.style.height = `${Math.min(field.scrollHeight, 132)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(input);
                }
              }}
            />
            {loading ? (
              <button type="button" aria-label="Stop generating" onClick={stop}>
                <Square size={14} />
              </button>
            ) : (
              <button type="button" aria-label="Send" onClick={() => send(input)} disabled={!input.trim()}>
                <Send size={16} />
              </button>
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}
