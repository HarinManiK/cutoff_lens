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
import { fetchAllRows } from "@/lib/supabase-rows";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { collegeSeedFacts, type CollegeFactSeed } from "@/lib/ai/college-seed";
import type { CutoffResult, GenderFilter } from "@/lib/types";

export type AiChatMessage = { role: "user" | "assistant"; content: string };

export type PageState = {
  rank?: string;
  seatType?: string;
  gender?: GenderFilter;
  year?: string;
  round?: string;
  selectedInstitutes?: string[];
  selectedPrograms?: string[];
  selectedDegrees?: string[];
  selectedDurations?: string[];
  selectedProgramTypes?: string[];
};

export type IncludedRow = {
  institute: string;
  branch: string;
  openingRank: number;
  closingRank: number;
  degree: string;
  duration: string;
  courseType: string;
};

export type FactCitation = CollegeFactSeed & { ref: number };

export type StretchRow = {
  institute: string;
  branch: string;
  closingRank: number;
  shortfall: number;
};

// Degree/type preference stated in chat ("btech only", "no dual").
// Message-level and overrides the page multi-selects when present, because
// it reflects the latest intent. Applied to the evidence itself so the model
// AND the deterministic fallback both obey it.
export type DegreePreference = {
  degrees: string[] | null;
  programTypes: string[] | null;
  label: string | null;
};

function extractDegreePreference(text: string): DegreePreference {
  const n = text.toLowerCase();
  const exclusive = /\b(only|just|exclusively|strictly)\b/.test(n);
  const noDual = /\bno\s+dual\b|\bwithout\s+dual\b|\bsingle\s+degree\b|\bnot?\s+\w{0,12}\s+dual\b/.test(n);
  const cleaned = n.replace(/b\.?\s?tech\s*\+\s*m\.?\s?tech/g, " ");
  const degrees: string[] = [];
  if (exclusive && /\bb\.?\s?tech\b/.test(cleaned)) degrees.push("B.Tech");
  if (exclusive && (/\bb\.?\s?s\.?\b/.test(n) || /\bbs\b/.test(n))) degrees.push("B.S.");
  if (exclusive && /\bb\.?\s?arch\b/.test(n)) degrees.push("B.Arch");
  const programTypes = noDual || degrees.length > 0 ? ["Single Degree"] : null;
  const label = degrees.length > 0 ? `${degrees.join("/").replace(/\./g, "")}-only` : programTypes ? "single-degree-only" : null;
  return {
    degrees: degrees.length > 0 ? degrees : null,
    programTypes,
    label,
  };
}

export type GroundedContext = {
  rank: number | null;
  seatType: string;
  gender: GenderFilter;
  genderStated: boolean;
  needsGender: boolean;
  preference: string | null;
  year: number;
  round: number;
  totalMatchingRows: number;
  includedRows: IncludedRow[];
  truncated: boolean;
  stretchRows: StretchRow[];
  facts: FactCitation[];
  interpretation: string;
  isGreeting: boolean;
};

// Intent gate: greetings and small talk carry no question, so they get no
// grounding data. This is what keeps "Hi" to one line without scripting
// answers: with no rows/facts injected, there is nothing to dump.
// Anything mentioning a rank, category, college, branch or topic is counselling.
const COUNSELLING_SIGNAL =
  /\b(jee|advanced|iit|rank|crl|air|cutoff|closing|opening|college|branch|campus|placement|package|ctc|salary|median|average|fee|tuition|curriculum|syllabus|hostel|mess|gender|male|female|category|open|obc|ews|sc\b|st\b|pwd|general|option|options|admission|seat|compare|eligible|cse|computer|electrical|mechanical|civil|chemical|aerospace|engineering|science|startup|incubat|research|faculty|fests?|clubs?)\b|\d{2,7}/i;

const GREETING_PATTERN =
  /^(hi+|hey+|hello+|namaste|yo|sup|good\s?(morning|afternoon|evening|day)|how\s?are\s?you|howdy|hais?)[\s!.,?]*$/i;

export function isGreetingLike(message: string) {
  const text = message.trim();
  if (!text || text.length > 140) return false;
  if (COUNSELLING_SIGNAL.test(text)) return false;
  return GREETING_PATTERN.test(text.replace(/\s+/g, " "));
}

const MAX_ROWS = 60;
const MAX_FACTS = 12;

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

function parsePositiveInteger(value?: string | null) {
  if (!value) return null;
  const parsed = Number(String(value).replace(/[,\s]/g, ""));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function allUserText(messages: AiChatMessage[]) {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

export function rankFromMessage(message: string) {
  const rankPhrase = message.match(/\b(?:rank|crl|air)\D{0,20}(\d[\d,\s]{0,8})\b/i);
  if (rankPhrase) return parsePositiveInteger(rankPhrase[1]);
  const normalized = message.toLowerCase();
  const looksRanky =
    /\b(got|scored|score|eligible|option|options|college|colleges|get|admission|seat)\b/.test(normalized) ||
    /\b(category|male|female|gender|open|general|obc|ews|sc|st|pwd)\b/.test(normalized);
  const broad = message.match(/\b(\d{2,6})\b/);
  return broad && looksRanky ? parsePositiveInteger(broad[1]) : null;
}

function seatTypeFromMessage(message: string) {
  const n = message.toLowerCase();
  if (/\bobc\b|\bobc[-\s]?ncl\b/.test(n)) return n.includes("pwd") ? "OBC-NCL (PwD)" : "OBC-NCL";
  if (/\bews\b/.test(n)) return n.includes("pwd") ? "EWS (PwD)" : "EWS";
  if (/\bsc\b/.test(n)) return n.includes("pwd") ? "SC (PwD)" : "SC";
  if (/\bst\b/.test(n)) return n.includes("pwd") ? "ST (PwD)" : "ST";
  if (/\bopen\b|\bcrl\b|\bgeneral\b/.test(n)) return n.includes("pwd") ? "OPEN (PwD)" : "OPEN";
  return null;
}

function genderFromMessage(message: string): GenderFilter | null {
  const n = message.toLowerCase();
  if (/\bfemale\b|\bgirl\b|\bwomen\b|\bwoman\b/.test(n)) return "Female";
  if (/\bmale\b|\bboy\b|\bgender[-\s]?neutral\b/.test(n)) return "Male";
  return null;
}

function yearFromMessage(message: string) {
  const m = message.match(/\b(202[4-9])\b/);
  return m ? Number(m[1]) : null;
}

function roundFromMessage(message: string) {
  const m = message.match(/\bround\s*(\d{1,2})\b/i);
  if (m) return Number(m[1]);
  return null;
}

async function loadCutoffRows(seatType: string, gender: GenderFilter, year: number, round: number) {
  const josaaGender = toJosaaGender(gender);
  const supabase = createServerSupabaseClient();
  if (supabase) {
    const build = () =>
      supabase
        .from("cutoff_results")
        .select(
          "id, year, round, institute, program, quota, seat_type, gender, opening_rank_raw, closing_rank_raw, opening_rank_number, closing_rank_number, is_preparatory",
        )
        .eq("exam_slug", "jee-advanced")
        .eq("year", year)
        .eq("round", round)
        .eq("seat_type", seatType)
        .eq("gender", josaaGender)
        .eq("is_preparatory", false)
        .order("institute", { ascending: true })
        .order("program", { ascending: true });
    const data = await fetchAllRows<SupabaseCutoffRow>(build);
    return data.map(toResult);
  }
  const rows = await loadLocalJeeAdvancedCutoffs();
  return rows
    .filter((r) => r.year === year)
    .filter((r) => r.round === round)
    .filter((r) => r.seatType === seatType)
    .filter((r) => r.gender === josaaGender)
    .filter((r) => !r.isPreparatory);
}

const TOPIC_KEYWORDS: Record<string, string[]> = {
  placements: ["placement", "package", "median", "average", "ctc", "salary", "offer", "recruit"],
  fees: ["fee", "fees", "tuition", "waiver", "mcm", "scholarship", "mess", "hostel charge"],
  rules: ["branch change", "branch-change", "grading", "cgpa", "minor", "honor", "double major", "rulebook", "curriculum", "syllabus"],
  support: ["counsell", "mental", "gender", "pwd", "diversity", "ragging", "support"],
  startup: ["startup", "incubat", "e-cell", "ecell", "entrepreneur", "e-summit"],
  media: ["campus life", "hostel life", "student media", "insight", "fifth estate", "watch out"],
  counselling: ["josaa", "round", "seat matrix", "supernumerary", "cutoff", "closing rank", "business rule"],
};

function detectTopics(text: string) {
  const n = text.toLowerCase();
  return Object.entries(TOPIC_KEYWORDS)
    .filter(([, kws]) => kws.some((k) => n.includes(k)))
    .map(([topic]) => topic);
}

function detectInstitutes(text: string) {
  const n = text.toLowerCase();
  const names = [
    "bombay", "delhi", "madras", "kanpur", "kharagpur", "roorkee", "guwahati", "hyderabad",
    "bhu", "varanasi", "indore", "dhanbad", "ism", "patna", "gandhinagar", "mandi",
    "jodhpur", "ropar", "bhubaneswar", "jammu", "tirupati", "palakkad", "bhilai", "dharwad", "goa",
  ];
  return names.filter((name) => n.includes(name));
}

async function loadAllFacts(): Promise<CollegeFactSeed[]> {
  const supabase = createServerSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("college_facts")
      .select("institute, topic, subtype, claim, source_url, source_title, publisher, published_ay, format, coverage")
      .limit(2000);
    if (!error && data && data.length > 0) return data as CollegeFactSeed[];
  }
  return collegeSeedFacts;
}

export async function buildGroundedContext(
  lastUserMessage: string,
  pageState: PageState,
  messages: AiChatMessage[] = [],
): Promise<GroundedContext> {
  const text = allUserText(messages) || lastUserMessage;
  const messageRank = rankFromMessage(text);
  const pageRank = parsePositiveInteger(pageState.rank);
  const rank = messageRank ?? pageRank;

  const seatRaw = seatTypeFromMessage(text) ?? pageState.seatType ?? "OPEN";
  const seatType = seatTypes.includes(seatRaw) ? seatRaw : "OPEN";
  const statedGender = genderFromMessage(text);
  const gender = statedGender ?? pageState.gender ?? "Male";
  // Gender picks the entire seat pool (Female-only vs Gender-Neutral), so a
  // defaulted gender must never silently answer a rank question. Ask instead.
  // Page rank present means the student sees their filters in the UI, so the
  // visible default counts as stated there; incognito/fresh sessions ask.
  const genderStated = Boolean(statedGender) || pageRank !== null;

  const pageYear = Number(pageState.year);
  const pageRound = Number(pageState.round);
  const year = yearFromMessage(text) ?? (Number.isInteger(pageYear) && pageYear > 0 ? pageYear : 2026);
  const round = roundFromMessage(text) ?? (Number.isInteger(pageRound) && pageRound > 0 ? pageRound : 5);

  // Greeting/small talk: no question asked, so load nothing. The model gets
  // an empty evidence set and a brevity instruction instead of 60 rows.
  if (!rank && isGreetingLike(lastUserMessage)) {
    return {
      rank,
      seatType,
      gender,
      genderStated,
      needsGender: false,
      year,
      round,
      totalMatchingRows: 0,
      includedRows: [],
      truncated: false,
      stretchRows: [],
      facts: [],
      interpretation: `rank=not provided, category=${seatType}, gender=${gender}, year=${year}, round=${round}`,
      isGreeting: true,
      preference: null,
    };
  }

  // Rank given but gender defaulted and invisible to the student: ask for
  // gender rather than answering from the wrong seat pool. Empty evidence
  // set, same as greetings.
  if (rank && !genderStated) {
    return {
      rank,
      seatType,
      gender,
      genderStated,
      needsGender: true,
      year,
      round,
      totalMatchingRows: 0,
      includedRows: [],
      truncated: false,
      stretchRows: [],
      facts: [],
      interpretation: `rank=${formatRank(rank)}, category=${seatType}, gender=unknown (asked), year=${year}, round=${round}`,
      isGreeting: false,
      preference: null,
    };
  }

  const rows = await loadCutoffRows(seatType, gender, year, round);

  const institutes = pageState.selectedInstitutes ?? [];
  const programs = pageState.selectedPrograms ?? [];
  const degrees = pageState.selectedDegrees ?? [];
  const durations = pageState.selectedDurations ?? [];
  const types = pageState.selectedProgramTypes ?? [];

  const msgPref = extractDegreePreference(text);
  const effectiveDegrees = msgPref.degrees ?? degrees;
  const effectiveTypes = msgPref.programTypes ?? types;

  const selectionFiltered = rows
    .filter((r) => (institutes.length ? institutes.includes(r.institute) : true))
    .filter((r) => (programs.length ? programs.includes(r.program) : true))
    .filter((r) => {
      if (!effectiveDegrees.length) return true;
      return effectiveDegrees.includes(programMeta(r.program).degree);
    })
    .filter((r) => {
      if (!durations.length) return true;
      return durations.includes(programMeta(r.program).duration);
    })
    .filter((r) => {
      if (!effectiveTypes.length) return true;
      return effectiveTypes.includes(programMeta(r.program).programType);
    });

  const filtered = selectionFiltered
    .filter((r) => (rank ? r.closingRankNumber >= rank : true))
    .sort(compareCutoffByInstituteAndProgram);

  const includedRows: IncludedRow[] = filtered.slice(0, MAX_ROWS).map((r) => {
    const meta = programMeta(r.program);
    return {
      institute: shortenInstituteName(r.institute),
      branch: programShortName(r.program),
      openingRank: r.openingRankNumber,
      closingRank: r.closingRankNumber,
      degree: meta.degree,
      duration: meta.duration,
      courseType: meta.programType,
    };
  });

  const allFacts = await loadAllFacts();
  const topics = detectTopics(`${lastUserMessage} ${text}`);
  const institutesMentioned = detectInstitutes(`${lastUserMessage} ${text}`);
  const topicSet = new Set(topics.length ? topics : ["placements", "counselling"]);

  const scored = allFacts
    .map((f) => {
      let score = 0;
      if (topicSet.has(f.topic)) score += 2;
      if (f.topic === "counselling") score += 1;
      const inst = f.institute.toLowerCase();
      if (institutesMentioned.some((m) => inst.includes(m) || m.includes(inst.split(" ").pop() ?? ""))) score += 3;
      if (f.coverage === "verified") score += 1;
      if (f.coverage === "not_published" || f.coverage === "missing") score -= 1;
      return { f, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FACTS);

  const facts: FactCitation[] = scored.map((s, i) => ({ ...s.f, ref: i + 1 }));

  const rankText = rank ? formatRank(rank) : "not provided";
  const interpretation = `rank=${rankText}, category=${seatType}, gender=${gender}, year=${year}, round=${round}${msgPref.label ? `, pref=${msgPref.label}` : ""}`;

  // Near misses: options that closed just below the student's rank. Cutoffs
  // shift year to year, so a miss by a hair is worth one labeled line —
  // never mixed with within-reach options.
  let stretchRows: StretchRow[] = [];
  if (rank) {
    const band = Math.max(100, Math.round(rank * 0.03));
    stretchRows = selectionFiltered
      .filter((r) => r.closingRankNumber < rank && r.closingRankNumber >= rank - band)
      .sort((a, b) => b.closingRankNumber - a.closingRankNumber)
      .slice(0, 5)
      .map((r) => ({
        institute: shortenInstituteName(r.institute),
        branch: programShortName(r.program),
        closingRank: r.closingRankNumber,
        shortfall: rank - r.closingRankNumber,
      }));
  }

  return { rank, seatType, gender, genderStated, needsGender: false, year, round, totalMatchingRows: filtered.length, includedRows, truncated: filtered.length > includedRows.length, stretchRows, facts, interpretation, isGreeting: false, preference: msgPref.label };
}
