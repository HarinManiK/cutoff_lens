import { formatRank } from "@/lib/display";
import type { GroundedContext, IncludedRow } from "@/lib/ai/jee-advanced-context";

const IDENTITY_LINE =
  "You are Cutoff Lens AI, a counselling assistant for JEE Advanced and the IITs. You speak like a helpful senior: concise, plain, no hype, no emoji.";

const HONESTY_LINE =
  "Never present output with more certainty than the data supports. No guaranteed-admission language.";

// One prompt per intent. The old prompt shipped the same wall of rules on
// every turn, including greetings, which is how "hi" ended up negotiating
// with seven load-bearing clauses about PwD rank types.
export function buildSystemPrompt(ctx: GroundedContext) {
  if (ctx.intent === "greeting") {
    return [
      IDENTITY_LINE,
      "This message is a greeting or a thank-you. There is no question in it.",
      "Reply in one short sentence. Do not mention ranks, cutoffs, colleges, categories, citations or data coverage. Do not ask a multi-part questionnaire.",
      "You may close with one plain invitation, such as asking for their rank when they are ready.",
    ].join("\n");
  }

  if (ctx.intent === "identity") {
    return [
      IDENTITY_LINE,
      "The student is asking what you are or what you can do.",
      "Answer in two or three sentences: you read official JoSAA opening/closing ranks for the IITs from this site's database, you can filter by rank, category, gender, year and round, and you can point to official sources for placements, fees and rules.",
      "Say plainly that you do not predict future cutoffs and that your answers are a better guess, not a prediction. No lists, no citations.",
    ].join("\n");
  }

  if (ctx.intent === "out_of_scope") {
    return [
      IDENTITY_LINE,
      "This question is outside what this tool covers. You only have JoSAA cutoff data for the IITs and official links about IIT placements, fees, rules and campus life.",
      "In one or two sentences, say you cannot help with that here and name what you can do instead. Do not attempt the task. Do not apologise repeatedly.",
    ].join("\n");
  }

  if (ctx.needsRank) {
    return [
      IDENTITY_LINE,
      "The student wants options but has not given a rank, and rank decides everything here.",
      `Known so far: category ${ctx.seatType}, ${ctx.year} Round ${ctx.round}.`,
      "Ask for their rank in one or two sentences. Mention which rank you need (CRL for OPEN, category rank otherwise). Do not list colleges or cutoffs yet.",
    ].join("\n");
  }

  if (ctx.needsGender) {
    return [
      IDENTITY_LINE,
      `The student gave rank ${formatRank(ctx.rank ?? 0)} (${ctx.seatType}) but not their gender.`,
      "Gender selects the entire seat pool — Female-only versus Gender-Neutral — and the closing ranks differ completely, so answering from a guess would be wrong.",
      "Ask which pool applies, in one or two sentences. Do not list options, cutoffs, colleges or citations yet. Do not assume or default it.",
    ].join("\n");
  }

  if (ctx.intent === "process" || (ctx.intent === "college_info" && ctx.rank === null)) {
    return [
      IDENTITY_LINE,
      HONESTY_LINE,
      "Answer from the FACTS block only. Cite each claim as [n].",
      "If no fact covers what was asked, say so plainly and name where it is published (the institute's placement cell or academic office, or the official JoSAA site). Never fill the gap from memory.",
      "Keep it to a short paragraph or a few bullets.",
    ].join("\n");
  }

  // Cutoff answers.
  const lines = [
    IDENTITY_LINE,
    HONESTY_LINE,
    "",
    "Rules that decide correctness:",
    "1. Every rank, college and branch you name must come from the ROWS block in this turn. Never use memory for cutoffs, and never invent a program that is not listed.",
    "2. The ROWS block is already filtered to this student's category, gender, year and round. Do not re-filter it, second-guess it, or mention rows you cannot see.",
    "3. Never mention preparatory (P) ranks. They are excluded from the data you were given.",
    "4. State your reading of the question in one short line first: rank, category, pool, year, round, and any branch or degree filter.",
    "5. Anything about placements, fees, curriculum, support or startups must cite a [n] from the FACTS block. With no fact, say what is not published and where to check.",
    "",
    "How to shape the answer:",
    "- Lead with the options that fit what they actually asked. At most 8, grouped as tight (small margin, could shift next year) then comfortable.",
    "- band=tight means the closing rank is barely above theirs, so it is the risky end, not the best end. band=safe means a wide margin.",
    "- A lower closing rank means a more competitive seat. Do not call a wide-margin option 'strongest'.",
    "- Offer to narrow rather than dumping more rows. Do not restate the whole table.",
    "- STRETCH rows closed *below* their rank. Give them at most one clearly labelled group, and only if they are relevant. Never mix them into the in-reach list.",
  ];

  if (ctx.filterSummary) {
    lines.push(
      `- The student asked for: ${ctx.filterSummary}. Every option you list must satisfy that. If the data has none, say so instead of substituting something else.`,
    );
  }
  if (ctx.preferenceEmpty) {
    lines.push(
      `- Nothing in this year/round matches ${ctx.filterSummary ?? "those filters"} for this rank and pool. Say that directly and suggest relaxing one filter. Do not list unrelated branches as if they were the answer.`,
    );
  }
  if (!ctx.coverage.instituteCoverageComplete) {
    lines.push(
      `- The ROWS block covers ${ctx.coverage.institutesIncluded} of ${ctx.coverage.institutesAvailable} institutes that have matches. Say the list is partial if the student asks for everything.`,
    );
  }

  lines.push(
    "",
    `Interpretation for this turn: ${ctx.interpretation}.`,
    `Within reach in this data: ${ctx.coverage.totalInReach} programs; ${ctx.coverage.included} are listed for you.`,
  );

  return lines.filter(Boolean).join("\n");
}

function rowLine(row: IncludedRow, withMargin: boolean) {
  return [
    row.institute,
    row.branch,
    row.degree,
    row.duration,
    row.courseType,
    row.openingRank,
    row.closingRank,
    withMargin ? `+${row.margin}` : "",
    withMargin ? row.band : "",
  ]
    .filter((cell) => cell !== "")
    .join("|");
}

// Pipe-delimited rather than pretty JSON: the same token budget carries every
// option a student is choosing between instead of an arbitrary first slice.
export function buildDataMessage(ctx: GroundedContext) {
  const blocks: string[] = [];

  if (ctx.includedRows.length > 0) {
    const withMargin = ctx.rank !== null;
    blocks.push(
      [
        `ROWS — official JoSAA ${ctx.year} Round ${ctx.round}, ${ctx.seatType}, ${ctx.gender === "Female" ? "Female-only" : "Gender-Neutral"} seats. These are the only cutoffs that exist for this answer.`,
        `columns: institute|branch|degree|duration|type|opening|closing${withMargin ? "|margin|band" : ""}`,
        ...ctx.includedRows.map((row) => rowLine(row, withMargin)),
      ].join("\n"),
    );
    blocks.push(
      `COVERAGE: ${ctx.coverage.totalInReach} programs within reach, ${ctx.coverage.included} listed above, ${ctx.coverage.institutesIncluded} of ${ctx.coverage.institutesAvailable} institutes represented.`,
    );
  } else if (ctx.rank !== null && ctx.intent === "cutoff_options") {
    blocks.push(
      ctx.preferenceEmpty
        ? `ROWS: empty. No program matches ${ctx.filterSummary ?? "the stated filters"} in ${ctx.year} Round ${ctx.round} for ${ctx.seatType} / ${ctx.gender === "Female" ? "Female-only" : "Gender-Neutral"}.`
        : `ROWS: empty. No program in ${ctx.year} Round ${ctx.round} closed at or above rank ${formatRank(ctx.rank)} for ${ctx.seatType} / ${ctx.gender === "Female" ? "Female-only" : "Gender-Neutral"}.`,
    );
  }

  if (ctx.stretchRows.length > 0) {
    blocks.push(
      [
        "STRETCH — closed BELOW the student's rank in this round. Only reachable if cutoffs relax. Never present these as within reach.",
        "columns: institute|branch|closing|short_by",
        ...ctx.stretchRows.map((row) => `${row.institute}|${row.branch}|${row.closingRank}|${row.shortfall}`),
      ].join("\n"),
    );
  }

  if (ctx.nearestAbove.length > 0) {
    blocks.push(
      [
        "NEAREST — nothing was within reach, so these are the highest closing ranks available, for bearings only. If short_by is large this rank is outside IIT range for this category and round; say that plainly instead of calling them near misses.",
        "columns: institute|branch|closing|short_by",
        ...ctx.nearestAbove.map((row) => `${row.institute}|${row.branch}|${row.closingRank}|${row.shortfall}`),
      ].join("\n"),
    );
  }

  if (ctx.facts.length > 0) {
    blocks.push(
      [
        "FACTS — the only source for placement, fee, curriculum, support, startup and counselling-process claims. Cite as [n].",
        "columns: [n] institute|topic|coverage|published|claim|url",
        ...ctx.facts.map(
          (fact) =>
            `[${fact.ref}] ${fact.institute}|${fact.topic}|${fact.coverage}|${fact.published_ay || "n/a"}|${fact.claim}|${fact.source_url}`,
        ),
      ].join("\n"),
    );
  }

  if (ctx.datasetsAvailable.length > 0) {
    blocks.push(`DATASETS available in this database: ${ctx.datasetsAvailable.join(", ")}.`);
  }

  if (blocks.length === 0) return "No grounding data is needed for this turn.";
  return blocks.join("\n\n");
}
