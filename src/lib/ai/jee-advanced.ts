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
  excludedByPreferenceCount: number;
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
  if (/\bphysics\b|\bgeophysics\b|\bphysical science\b/.test(text)) {
    notes.push("avoid physics, geophysics, and physical science courses");
  }
  if (/\bchemistry\b|\bchemical sciences?\b/.test(text)) {
    notes.push("avoid direct chemistry and chemical science courses");
  }

  return notes;
}

function matchesPreferenceExclusion(program: string, preferenceNotes: string[]) {
  if (preferenceNotes.length === 0) return false;

  const programName = programShortName(program).toLowerCase();

  return preferenceNotes.some((note) => {
    if (note.includes("design")) return /\bdesign\b/.test(programName);
    if (note.includes("architecture")) return /\barchitecture\b|\bb\.arch\b/.test(programName);
    if (note.includes("mathematics")) {
      return (
        /\bmathematics\b/.test(programName) &&
        !/\bmathematics\s*(and|&)\s*computing\b/.test(programName)
      );
    }
    if (note.includes("physics")) return /\bphysics\b|\bgeophysics\b|\bphysical science\b/.test(programName);
    if (note.includes("chemistry")) {
      return /\bchemistry\b|\bchemical sciences?\b/.test(programName);
    }

    return false;
  });
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

  const rowsBeforePreference = rows
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
    });

  const filteredRows = rowsBeforePreference
    .filter((row) => !matchesPreferenceExclusion(row.program, preferenceNotes))
    .sort(compareCutoffByInstituteAndProgram);

  const includedRows = filteredRows.slice(0, MAX_ROWS_FOR_AI).map((row) => {
    const meta = programMeta(row.program);

    return {
      institute: shortenInstituteName(row.institute),
      branch: programShortName(row.program),
      openingRank: row.openingRankNumber,
      closingRank: row.closingRankNumber,
      degree: meta.degree,
      duration: meta.duration,
      courseType: meta.programType,
    };
  });

  return {
    rank,
    rankWasInferredFromMessage: Boolean(messageRank),
    preferenceNotes,
    excludedByPreferenceCount: rowsBeforePreference.length - filteredRows.length,
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
    "- Use the user's latest message and previous preferences. If they dislike a course family, stop recommending that family.",
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
    context.excludedByPreferenceCount > 0
      ? `${context.excludedByPreferenceCount} otherwise-matching rows were removed because of user preferences.`
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
      "Enter your rank first, bro. For JEE Advanced, I also need category and gender to keep this accurate.",
      `Current category: ${context.seatType}. Current gender: ${context.gender}.`,
    ].join("\n\n");
  }

  if (context.totalMatchingRows === 0) {
    return [
      `Based on 2025 official Round 5 IIT data, I don't see matching options for rank ${formatRank(context.rank)} with ${context.seatType} / ${context.gender}.`,
      context.preferenceNotes.length > 0
        ? "Your course preferences also removed some otherwise eligible rows. You can relax those preferences if you want a wider list."
        : "Try changing category/gender only if that matches your actual rank type, or remove branch/institution filters.",
    ].join("\n\n");
  }

  const options = uniqueOptions(context.includedRows);
  const bestBrand = options.slice(0, 6);
  const bestBranch = [...options].sort((a, b) => a.closingRank - b.closingRank).slice(0, 6);
  const safer = [...options].sort((a, b) => b.closingRank - a.closingRank).slice(0, 5);

  return [
    `Got it. Based on 2025 official Round 5 IIT data for rank ${formatRank(context.rank)} (${context.seatType}, ${context.gender}), I filtered your current options${context.preferenceNotes.length > 0 ? ` and respected this preference: ${context.preferenceNotes.join("; ")}` : ""}.`,
    "",
    "Good picks after that filter:",
    ...bestBrand.map((option, index) => `${index + 1}. ${formatOption(option, context.rank)}`),
    "",
    "Strong branch-side picks:",
    ...bestBranch.map((option, index) => `${index + 1}. ${formatOption(option, context.rank)}`),
    "",
    "Safer picks by closing-rank margin:",
    ...safer.map((option, index) => `${index + 1}. ${formatOption(option, context.rank)}`),
    context.truncated
      ? "\nI used the strongest included rows from your current filtered result set. Narrow Institution/Branch filters if you want a tighter comparison."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
