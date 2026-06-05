import {
  compareCutoffByInstituteAndProgram,
  formatRank,
  programMeta,
  programShortName,
  seatTypes,
  shortenInstituteName,
  toJosaaGender,
} from "@/lib/display";
import { loadLocalJeeAdvancedCutoffs } from "@/lib/local-cutoffs";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { CutoffResult, GenderFilter } from "@/lib/types";

type SupabaseCutoffRow = {
  id: string;
  year: number;
  round: number;
  institute: string;
  program: string;
  quota: string;
  seat_type: string;
  gender: string;
  opening_rank_raw: string;
  closing_rank_raw: string;
  opening_rank_number: number;
  closing_rank_number: number;
  is_preparatory: boolean;
};

export type AiChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type JeeAdvancedPageState = {
  rank?: string;
  seatType?: string;
  gender?: GenderFilter;
  selectedInstitutes?: string[];
  selectedPrograms?: string[];
  selectedDegrees?: string[];
  selectedDurations?: string[];
  selectedProgramTypes?: string[];
  tableSearch?: string;
};

export type JeeAdvancedAiContext = {
  rank: number | null;
  rankWasInferredFromMessage: boolean;
  preferenceNotes: string[];
  preferenceMatchedRows: number;
  seatType: string;
  gender: GenderFilter;
  year: 2025;
  round: 5;
  totalMatchingRows: number;
  includedRows: Array<{
    institute: string;
    branch: string;
    openingRank: number;
    closingRank: number;
    degree: string;
    duration: string;
    courseType: string;
    preferenceFit: "preferred" | "tradeoff";
    preferenceReason: string | null;
  }>;
  truncated: boolean;
  activeFilters: {
    institutions: string[];
    branches: string[];
    degrees: string[];
    durations: string[];
    courseTypes: string[];
  };
};

const MAX_ROWS_FOR_AI = 180;

function parsePositiveInteger(value?: string | null) {
  if (!value) return null;
  const parsed = Number(String(value).replace(/[,\s]/g, ""));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function rankFromMessage(message: string) {
  const rankPhrase = message.match(/\b(?:rank|crl|air)\D{0,20}(\d[\d,\s]{0,8})\b/i);
  if (rankPhrase) return parsePositiveInteger(rankPhrase[1]);

  const normalized = message.toLowerCase();
  const looksLikeDirectRankQuestion = /\b(got|scored|score|eligible|option|options|college|colleges|get|admission|seat)\b/.test(
    normalized,
  );
  const broadRank = message.match(/\b(\d{2,6})\b/);
  return broadRank && looksLikeDirectRankQuestion ? parsePositiveInteger(broadRank[1]) : null;
}

function seatTypeFromMessage(message: string) {
  const normalized = message.toLowerCase();

  if (/\bobc\b|\bobc[-\s]?ncl\b/.test(normalized)) return normalized.includes("pwd") ? "OBC-NCL (PwD)" : "OBC-NCL";
  if (/\bews\b/.test(normalized)) return normalized.includes("pwd") ? "EWS (PwD)" : "EWS";
  if (/\bsc\b/.test(normalized)) return normalized.includes("pwd") ? "SC (PwD)" : "SC";
  if (/\bst\b/.test(normalized)) return normalized.includes("pwd") ? "ST (PwD)" : "ST";
  if (/\bopen\b|\bcrl\b|\bgeneral\b/.test(normalized)) return normalized.includes("pwd") ? "OPEN (PwD)" : "OPEN";

  return null;
}

function genderFromMessage(message: string): GenderFilter | null {
  const normalized = message.toLowerCase();
  if (/\bfemale\b|\bgirl\b|\bwomen\b|\bwoman\b/.test(normalized)) return "Female";
  if (/\bmale\b|\bboy\b|\bgender[-\s]?neutral\b|\bgn\b/.test(normalized)) return "Male";
  return null;
}

function userMessageText(messages: AiChatMessage[]) {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");
}

function extractPreferenceNotes(messages: AiChatMessage[]) {
  const text = userMessageText(messages).toLowerCase();
  const dislikesAreRelevant = /\b(don't like|do not like|not interested|avoid|exclude|remove|hate|no )\b/.test(text);

  if (!dislikesAreRelevant) return [];

  const notes: string[] = [];

  if (/\bdesign\b/.test(text)) notes.push("avoid design courses");
  if (/\barchitecture\b|\barch\b/.test(text)) notes.push("avoid architecture courses");
  if (/\bmaths?\b|\bmathematics\b/.test(text)) notes.push("avoid direct mathematics courses");
  if (/\bphysics\b|\bphysical science\b/.test(text)) notes.push("avoid direct physics and physical science courses");
  if (/\bchemistry\b|\bchemical sciences?\b/.test(text)) {
    notes.push("avoid direct chemistry and chemical science courses");
  }

  return notes;
}

function preferenceIssueForProgram(program: string, preferenceNotes: string[]) {
  if (preferenceNotes.length === 0) return null;

  const programName = programShortName(program).toLowerCase();

  for (const note of preferenceNotes) {
    if (note.includes("design") && /\bdesign\b/.test(programName)) return "user said they do not like design";
    if (note.includes("architecture") && /\barchitecture\b|\bb\.arch\b/.test(programName)) {
      return "user said they do not like architecture";
    }
    if (note.includes("mathematics")) {
      const isDirectMath =
        /\bmathematics\b/.test(programName) &&
        !/\bmathematics\s*(and|&)\s*computing\b/.test(programName);
      if (isDirectMath) return "user said they do not like direct mathematics";
    }
    if (note.includes("physics") && /\bphysics\b|\bphysical science\b/.test(programName)) {
      return "user said they do not like direct physics or physical science";
    }
    if (note.includes("chemistry")) {
      const isDirectChemistry =
        /\bchemistry\b|\bchemical sciences?\b/.test(programName) &&
        !/\bchemical engineering\b/.test(programName);
      if (isDirectChemistry) return "user said they do not like direct chemistry";
    }
  }

  return null;
}

function toResult(row: SupabaseCutoffRow): CutoffResult {
  return {
    id: row.id,
    year: row.year,
    round: row.round,
    institute: row.institute,
    program: row.program,
    quota: row.quota,
    seatType: row.seat_type,
    gender: row.gender,
    openingRankRaw: row.opening_rank_raw,
    closingRankRaw: row.closing_rank_raw,
    openingRankNumber: row.opening_rank_number,
    closingRankNumber: row.closing_rank_number,
    isPreparatory: row.is_preparatory,
  };
}

async function loadJeeAdvancedRows(seatType: string, gender: GenderFilter) {
  const josaaGender = toJosaaGender(gender);
  const supabase = createServerSupabaseClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("cutoff_results")
      .select(
        "id, year, round, institute, program, quota, seat_type, gender, opening_rank_raw, closing_rank_raw, opening_rank_number, closing_rank_number, is_preparatory",
      )
      .eq("exam_slug", "jee-advanced")
      .eq("year", 2025)
      .eq("round", 5)
      .eq("seat_type", seatType)
      .eq("gender", josaaGender)
      .eq("is_preparatory", false)
      .limit(5000);

    if (error) throw new Error(error.message);
    return (data as SupabaseCutoffRow[]).map(toResult);
  }

  const rows = await loadLocalJeeAdvancedCutoffs();
  return rows
    .filter((row) => row.year === 2025)
    .filter((row) => row.round === 5)
    .filter((row) => row.seatType === seatType)
    .filter((row) => row.gender === josaaGender)
    .filter((row) => !row.isPreparatory);
}

export function shouldUseOfficialWebSearch(message: string) {
  const normalized = message.toLowerCase();
  return [
    "curriculum",
    "syllabus",
    "placement",
    "placements",
    "package",
    "median",
    "average",
    "fees",
    "fee",
    "course structure",
    "department",
    "faculty",
    "campus",
    "hostel",
    "official",
    "report",
  ].some((keyword) => normalized.includes(keyword));
}

export function needsRankForJeeAdvancedQuery(message: string) {
  const normalized = message.toLowerCase();
  const isRankScopedQuestion = [
    "my rank",
    "best picks",
    "best iit",
    "best branch",
    "what can i get",
    "which iit",
    "eligible",
    "options",
  ].some((phrase) => normalized.includes(phrase));

  return isRankScopedQuestion && !rankFromMessage(message);
}

export function isAllowedJeeAdvancedQuery(message: string) {
  const normalized = message.toLowerCase();
  return [
    "jee",
    "advanced",
    "iit",
    "rank",
    "college",
    "institution",
    "course",
    "branch",
    "cutoff",
    "closing",
    "opening",
    "placement",
    "curriculum",
    "syllabus",
    "fees",
    "hostel",
    "campus",
    "compare",
    "option",
    "options",
    "cse",
    "computer",
    "electrical",
    "mechanical",
    "civil",
    "chemical",
    "aerospace",
    "engineering",
    "science",
  ].some((keyword) => normalized.includes(keyword));
}

export async function buildJeeAdvancedContext(
  lastUserMessage: string,
  pageState: JeeAdvancedPageState,
  messages: AiChatMessage[] = [],
) {
  const allUserText = userMessageText(messages);
  const preferenceNotes = extractPreferenceNotes(messages);
  const messageRank = rankFromMessage(allUserText || lastUserMessage);
  const pageRank = parsePositiveInteger(pageState.rank);
  const rank = messageRank ?? pageRank;
  const seatType = seatTypeFromMessage(allUserText || lastUserMessage) ?? pageState.seatType ?? "OPEN";
  const validSeatType = seatTypes.includes(seatType) ? seatType : "OPEN";
  const gender = genderFromMessage(allUserText || lastUserMessage) ?? pageState.gender ?? "Male";
  const rows = await loadJeeAdvancedRows(validSeatType, gender);
  const activeInstitutes = pageState.selectedInstitutes ?? [];
  const activePrograms = pageState.selectedPrograms ?? [];
  const activeDegrees = pageState.selectedDegrees ?? [];
  const activeDurations = pageState.selectedDurations ?? [];
  const activeProgramTypes = pageState.selectedProgramTypes ?? [];

  const filteredRows = rows
    .filter((row) => (rank ? row.closingRankNumber >= rank : true))
    .filter((row) => (activeInstitutes.length > 0 ? activeInstitutes.includes(row.institute) : true))
    .filter((row) => (activePrograms.length > 0 ? activePrograms.includes(row.program) : true))
    .filter((row) => {
      const meta = programMeta(row.program);
      return activeDegrees.length > 0 ? activeDegrees.includes(meta.degree) : true;
    })
    .filter((row) => {
      const meta = programMeta(row.program);
      return activeDurations.length > 0 ? activeDurations.includes(meta.duration) : true;
    })
    .filter((row) => {
      const meta = programMeta(row.program);
      return activeProgramTypes.length > 0 ? activeProgramTypes.includes(meta.programType) : true;
    })
    .sort(compareCutoffByInstituteAndProgram);

  const includedRows = filteredRows.slice(0, MAX_ROWS_FOR_AI).map((row) => {
    const meta = programMeta(row.program);
    const preferenceReason = preferenceIssueForProgram(row.program, preferenceNotes);

    return {
      institute: shortenInstituteName(row.institute),
      branch: programShortName(row.program),
      openingRank: row.openingRankNumber,
      closingRank: row.closingRankNumber,
      degree: meta.degree,
      duration: meta.duration,
      courseType: meta.programType,
      preferenceFit: preferenceReason ? ("tradeoff" as const) : ("preferred" as const),
      preferenceReason,
    };
  });

  return {
    rank,
    rankWasInferredFromMessage: Boolean(messageRank),
    preferenceNotes,
    preferenceMatchedRows: filteredRows.filter((row) => preferenceIssueForProgram(row.program, preferenceNotes)).length,
    seatType: validSeatType,
    gender,
    year: 2025 as const,
    round: 5 as const,
    totalMatchingRows: filteredRows.length,
    includedRows,
    truncated: filteredRows.length > includedRows.length,
    activeFilters: {
      institutions: activeInstitutes.map(shortenInstituteName),
      branches: activePrograms.map(programShortName),
      degrees: activeDegrees,
      durations: activeDurations,
      courseTypes: activeProgramTypes,
    },
  };
}

export function buildJeeAdvancedSystemPrompt(context: JeeAdvancedAiContext, useOfficialWebSearch: boolean) {
  const rankText = context.rank ? formatRank(context.rank) : "not provided";

  return [
    "You are Cutoff Lens AI for JEE Advanced counselling only.",
    "Talk like a helpful counselling assistant, not like a database report.",
    "Answer only JEE Advanced, IIT, cutoff, branch, curriculum, fees, placements, and admission-related questions.",
    "If the user asks anything outside the cutoff database and approved-source scope, respond exactly: Sorry, can't fetch that info.",
    "",
    "Data authority rules:",
    "- Eligibility, cutoff, and 'what can I get?' answers must use only the provided cutoff rows from the Cutoff Lens database.",
    "- The current cutoff data scope is official 2025 JoSAA Round 5 IIT data.",
    "- Never use web search or model memory for cutoff eligibility.",
    "- Do not mention preparatory ranks or P ranks.",
    "- Female means Female-only seats. Male means Gender-Neutral seats.",
    "- OPEN uses CRL rank. Other categories use category rank. PwD seat types use PwD category rank.",
    "- If rank is missing for a rank-specific query, ask for rank, category, and gender instead of guessing.",
    "",
    "Conversation style:",
    "- Use the user's latest message and previous preferences. Treat dislikes as strong preferences, not absolute bans.",
    "- If a disliked/interdisciplinary course is still a strong IIT/brand/safety tradeoff, mention it honestly instead of hiding it.",
    "- Be concise, natural, and preference-aware.",
    "- Choose the answer structure yourself based on the question. Do not force the same categories every time.",
    "- Explain tradeoffs without promotional language.",
    "- Do not claim guaranteed admission; say these are based on 2025 Round 5 closing ranks.",
    "- If matching rows are truncated, say you are using the strongest included options and ask the user to narrow filters if needed.",
    "",
    "Web-source rules:",
    useOfficialWebSearch
      ? "- Official web search is available only for curriculum, syllabus, placements, fees, departments, and campus facts. Use only approved official domains from the tool. Cite source links. If official sources do not contain the answer, respond exactly: Sorry, can't fetch that info."
      : "- Web search is not available for this query. Do not answer non-cutoff facts from memory.",
    "",
    `Current interpreted filters: rank=${rankText}, category=${context.seatType}, gender=${context.gender}, year=2025, round=5.`,
    context.preferenceNotes.length > 0 ? `User preferences to respect: ${context.preferenceNotes.join("; ")}.` : "",
    context.preferenceMatchedRows > 0
      ? `${context.preferenceMatchedRows} eligible rows conflict with stated preferences; they are still included as tradeoff options when IIT/brand/safety makes them worth considering.`
      : "",
    `Matching cutoff rows available to you: ${context.totalMatchingRows}. Rows included in this prompt: ${context.includedRows.length}.`,
  ].join("\n");
}

export function buildJeeAdvancedDataMessage(context: JeeAdvancedAiContext) {
  return [
    "Cutoff database context for this user. Use this JSON as the only source for eligibility:",
    JSON.stringify(context, null, 2),
  ].join("\n");
}

function formatOption(
  option: JeeAdvancedAiContext["includedRows"][number],
  rank: number | null,
) {
  const margin = rank ? `, margin +${formatRank(option.closingRank - rank)}` : "";
  return `${option.institute} - ${option.branch} (opening ${formatRank(option.openingRank)}, closing ${formatRank(option.closingRank)}${margin})`;
}

function formatTradeoffNote(option: JeeAdvancedAiContext["includedRows"][number]) {
  return option.preferenceReason ? ` - tradeoff: ${option.preferenceReason}` : "";
}

function uniqueOptions(options: JeeAdvancedAiContext["includedRows"]) {
  const seen = new Set<string>();

  return options.filter((option) => {
    const key = `${option.institute}|${option.branch}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildDatabaseOnlyJeeAdvancedAnswer(context: JeeAdvancedAiContext) {
  if (!context.rank) {
    return [
      "What's your JEE Advanced rank?",
      `I also need the correct category rank type. Current category is ${context.seatType} and gender is ${context.gender}.`,
    ].join("\n\n");
  }

  if (context.totalMatchingRows === 0) {
    return [
      `Based on 2025 official Round 5 IIT data, I don't see matching options for rank ${formatRank(context.rank)} with ${context.seatType} / ${context.gender}.`,
      context.preferenceNotes.length > 0
        ? "Your preferences are noted, but the current rank/category/filter combination itself has no matching rows."
        : "Try changing category/gender only if that matches your actual rank type, or remove branch/institution filters.",
    ].join("\n\n");
  }

  const options = uniqueOptions(context.includedRows);
  const preferredOptions = options.filter((option) => option.preferenceFit === "preferred");
  const tradeoffOptions = options.filter((option) => option.preferenceFit === "tradeoff");
  const bestBrand = options
    .filter((option) => option.preferenceFit === "preferred")
    .slice(0, 6);
  const preferenceAligned = preferredOptions.slice(0, 6);
  const showPreferenceAligned = !bestBrand.every((option, index) => preferenceAligned[index] === option);
  const worthwhileTradeoffs = tradeoffOptions.slice(0, 4);
  const safer = [...preferredOptions].sort((a, b) => b.closingRank - a.closingRank).slice(0, 5);

  return [
    `Got it. Based on 2025 official Round 5 IIT data for rank ${formatRank(context.rank)} (${context.seatType}, ${context.gender}), I treated your preference as important but not an automatic delete rule${context.preferenceNotes.length > 0 ? `: ${context.preferenceNotes.join("; ")}` : ""}.`,
    "",
    "Best overall picks:",
    ...bestBrand.map((option, index) => `${index + 1}. ${formatOption(option, context.rank)}${formatTradeoffNote(option)}`),
    showPreferenceAligned ? "" : null,
    showPreferenceAligned ? "More preference-aligned picks:" : null,
    ...(showPreferenceAligned
      ? preferenceAligned.length > 0
        ? preferenceAligned.map((option, index) => `${index + 1}. ${formatOption(option, context.rank)}`)
        : ["No clean preference-aligned options remain in the included result set."]
      : []),
    worthwhileTradeoffs.length > 0 ? "" : null,
    worthwhileTradeoffs.length > 0 ? "Still worth considering despite preference mismatch:" : null,
    ...worthwhileTradeoffs.map((option, index) => `${index + 1}. ${formatOption(option, context.rank)}${formatTradeoffNote(option)}`),
    "",
    "Safer preference-aligned picks by closing-rank margin:",
    ...(safer.length > 0
      ? safer.map((option, index) => `${index + 1}. ${formatOption(option, context.rank)}`)
      : ["No safer preference-aligned options remain in the included result set."]),
    context.truncated
      ? "\nI used the strongest included rows from your current filtered result set. Narrow Institution/Branch filters if you want a tighter comparison."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
