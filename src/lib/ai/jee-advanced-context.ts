import {
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
import {
  classifyIntent,
  mentionedInstitutes,
  resolveSlots,
  type AiChatMessage,
  type Intent,
  type Slots,
} from "@/lib/ai/intent";
import type { CutoffResult, GenderFilter } from "@/lib/types";

export type { AiChatMessage } from "@/lib/ai/intent";

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
  margin: number;
  band: "tight" | "likely" | "safe";
};

export type StretchRow = {
  institute: string;
  branch: string;
  closingRank: number;
  shortfall: number;
};

export type FactCitation = CollegeFactSeed & { ref: number };

export type Coverage = {
  // Rows that satisfy every filter and are within reach.
  totalInReach: number;
  // Rows handed to the model.
  included: number;
  // Institutes represented in the included rows, out of those actually available.
  institutesIncluded: number;
  institutesAvailable: number;
  // True only when some institute is missing from the evidence entirely.
  instituteCoverageComplete: boolean;
};

export type GroundedContext = {
  intent: Intent;
  rank: number | null;
  seatType: string;
  gender: GenderFilter;
  year: number;
  round: number;
  needsRank: boolean;
  needsGender: boolean;
  // Filters that came from chat rather than the page, phrased for the answer.
  branchLabel: string | null;
  degreeLabel: string | null;
  instituteLabel: string | null;
  filterSummary: string | null;
  // Set when a stated preference matched nothing at all, which is a real
  // answer ("no physics options at this rank") and must not be silently
  // widened back to every branch.
  preferenceEmpty: boolean;
  includedRows: IncludedRow[];
  stretchRows: StretchRow[];
  nearestAbove: StretchRow[];
  coverage: Coverage;
  facts: FactCitation[];
  interpretation: string;
  datasetsAvailable: string[];
};

// Rows are handed to the model as compact pipe-delimited lines rather than
// pretty JSON. The old builder spent ~21k characters on 60 rows; the same
// budget now carries every row a student is realistically choosing between,
// which is what stops the model inventing or omitting options.
const MAX_ROWS = 140;
const MAX_FACTS = 8;
const MAX_STRETCH = 6;

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
    .filter((row) => row.year === year)
    .filter((row) => row.round === round)
    .filter((row) => row.seatType === seatType)
    .filter((row) => row.gender === josaaGender)
    .filter((row) => !row.isPreparatory);
}

const TOPIC_KEYWORDS: Record<string, string[]> = {
  placements: ["placement", "package", "median", "average", "ctc", "salary", "offer", "recruit", "intern", "job"],
  fees: ["fee", "fees", "tuition", "waiver", "mcm", "scholarship", "mess", "hostel"],
  rules: ["branch change", "branch-change", "grading", "cgpa", "minor", "honor", "honour", "double major", "rulebook", "curriculum", "syllabus", "academic"],
  support: ["counsell", "mental", "wellness", "pwd", "diversity", "ragging", "support", "inclusion"],
  startup: ["startup", "incubat", "e-cell", "ecell", "entrepreneur", "e-summit"],
  media: ["campus life", "hostel life", "student media", "insight", "fifth estate", "watch out", "life at", "how is"],
  counselling: ["josaa", "csab", "round", "seat matrix", "supernumerary", "business rule", "float", "freeze", "slide", "choice filling", "willingness", "document verification", "top 20 percentile"],
};

function detectTopics(text: string) {
  const normalized = text.toLowerCase();
  return Object.entries(TOPIC_KEYWORDS)
    .filter(([, keywords]) => keywords.some((keyword) => normalized.includes(keyword)))
    .map(([topic]) => topic);
}

async function loadAllFacts(): Promise<CollegeFactSeed[]> {
  const supabase = createServerSupabaseClient();
  if (supabase) {
    try {
      // PostgREST caps responses at 1000 rows regardless of .limit(), so this
      // reads through fetchAllRows like every other multi-row query.
      const data = await fetchAllRows<CollegeFactSeed>(() =>
        supabase
          .from("college_facts")
          .select("institute, topic, subtype, claim, source_url, source_title, publisher, published_ay, format, coverage")
          .order("institute", { ascending: true }),
      );
      if (data.length > 0) return data;
    } catch {
      // Fall through to the bundled seed rather than failing the whole answer.
    }
  }
  return collegeSeedFacts;
}

// Facts are only worth injecting when the student asked something they can
// answer. The old builder defaulted to placements+counselling on every turn,
// so a pure cutoff question came back decorated with placement-portal links
// that had nothing to do with it — citation noise reads as authority.
async function selectFacts(intent: Intent, text: string): Promise<FactCitation[]> {
  const topics = detectTopics(text);
  const institutes = mentionedInstitutes(text);
  if (intent === "cutoff_options" && topics.length === 0) return [];
  if (intent === "greeting" || intent === "identity" || intent === "out_of_scope") return [];
  if (topics.length === 0 && institutes.length === 0) return [];

  const all = await loadAllFacts();
  const topicSet = new Set(intent === "process" && topics.length === 0 ? ["counselling"] : topics);

  const scored = all
    .map((fact) => {
      let score = 0;
      if (topicSet.has(fact.topic)) score += 3;
      if (institutes.includes(fact.institute)) score += 3;
      if (fact.institute === "JoSAA" && topicSet.has("counselling")) score += 2;
      if (fact.coverage === "verified") score += 1;
      if (fact.coverage === "not_published" || fact.coverage === "missing") score -= 1;
      return { fact, score };
    })
    // A fact must match the topic or the named institute, not merely exist.
    .filter((entry) => entry.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FACTS);

  return scored.map((entry, index) => ({ ...entry.fact, ref: index + 1 }));
}

function band(closingRank: number, rank: number): IncludedRow["band"] {
  const margin = closingRank - rank;
  if (margin <= rank * 0.08) return "tight";
  if (margin <= rank * 0.4) return "likely";
  return "safe";
}

function toIncludedRow(row: CutoffResult, rank: number | null): IncludedRow {
  const meta = programMeta(row.program);
  return {
    institute: shortenInstituteName(row.institute),
    branch: programShortName(row.program),
    openingRank: row.openingRankNumber,
    closingRank: row.closingRankNumber,
    degree: meta.degree,
    duration: meta.duration,
    courseType: meta.programType,
    margin: rank ? row.closingRankNumber - rank : 0,
    band: rank ? band(row.closingRankNumber, rank) : "likely",
  };
}

// Institute-fair selection. Sorting by the display order and cutting at N —
// what the old builder did — deleted every institute past the cut, so a
// student was answered as if 15 IITs did not exist. Round-robin instead:
// every institute contributes its most competitive option before any
// institute contributes a second one.
function selectRows(rows: CutoffResult[], rank: number | null, limit: number) {
  const byInstitute = new Map<string, CutoffResult[]>();
  for (const row of rows) {
    const key = shortenInstituteName(row.institute);
    const bucket = byInstitute.get(key);
    if (bucket) bucket.push(row);
    else byInstitute.set(key, [row]);
  }
  for (const bucket of byInstitute.values()) {
    bucket.sort((a, b) => a.closingRankNumber - b.closingRankNumber);
  }

  const queues = [...byInstitute.entries()].sort(
    (a, b) => (a[1][0]?.closingRankNumber ?? 0) - (b[1][0]?.closingRankNumber ?? 0),
  );
  const picked: CutoffResult[] = [];
  for (let depth = 0; picked.length < limit; depth += 1) {
    let addedThisPass = false;
    for (const [, bucket] of queues) {
      if (depth >= bucket.length) continue;
      picked.push(bucket[depth]);
      addedThisPass = true;
      if (picked.length >= limit) break;
    }
    if (!addedThisPass) break;
  }

  return {
    picked: picked.map((row) => toIncludedRow(row, rank)).sort((a, b) => a.closingRank - b.closingRank),
    institutesAvailable: byInstitute.size,
    institutesIncluded: new Set(picked.map((row) => shortenInstituteName(row.institute))).size,
  };
}

function toStretchRow(row: CutoffResult, rank: number): StretchRow {
  return {
    institute: shortenInstituteName(row.institute),
    branch: programShortName(row.program),
    closingRank: row.closingRankNumber,
    shortfall: rank - row.closingRankNumber,
  };
}

async function availableDatasets(): Promise<string[]> {
  try {
    const rows = await loadLocalJeeAdvancedCutoffs();
    const keys = new Set(rows.map((row) => `${row.year} R${row.round}`));
    return [...keys].sort();
  } catch {
    return [];
  }
}

export async function buildGroundedContext(
  lastUserMessage: string,
  pageState: PageState,
  messages: AiChatMessage[] = [],
): Promise<GroundedContext> {
  const history = messages.length > 0 ? messages : [{ role: "user" as const, content: lastUserMessage }];
  const slots: Slots = resolveSlots(history);

  const pageRank = parsePositiveInteger(pageState.rank);
  const rank = slots.rank ?? pageRank;

  const seatRaw = slots.seatType ?? pageState.seatType ?? "OPEN";
  const seatType = seatTypes.includes(seatRaw) ? seatRaw : "OPEN";
  const gender = slots.gender ?? pageState.gender ?? "Male";

  const pageYear = Number(pageState.year);
  const pageRound = Number(pageState.round);
  const year = slots.year ?? (Number.isInteger(pageYear) && pageYear > 0 ? pageYear : 2026);
  const round = slots.round ?? (Number.isInteger(pageRound) && pageRound > 0 ? pageRound : 5);

  const intent = classifyIntent(lastUserMessage, rank !== null);

  // Gender picks the entire seat pool (Female-only vs Gender-Neutral) and the
  // closing ranks differ completely, so a defaulted gender must never quietly
  // answer a rank question. A rank typed into the page counts as stated,
  // because the student can see the gender toggle next to it.
  const genderStated = slots.gender !== null || pageRank !== null;
  const needsGender = intent === "cutoff_options" && rank !== null && !genderStated;
  const needsRank = intent === "cutoff_options" && rank === null;

  const branchLabel = slots.branch?.label ?? null;
  const filterSummary =
    [branchLabel, slots.degreeLabel, slots.instituteLabel].filter(Boolean).join(", ") || null;

  const interpretation = [
    `rank=${rank ? formatRank(rank) : "not provided"}`,
    `category=${seatType}`,
    `gender=${needsGender ? "unknown (asking)" : gender}`,
    `year=${year}`,
    `round=${round}`,
    filterSummary ? `filters=${filterSummary}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const emptyCoverage: Coverage = {
    totalInReach: 0,
    included: 0,
    institutesIncluded: 0,
    institutesAvailable: 0,
    instituteCoverageComplete: true,
  };

  const base: GroundedContext = {
    intent,
    rank,
    seatType,
    gender,
    year,
    round,
    needsRank,
    needsGender,
    branchLabel,
    degreeLabel: slots.degreeLabel,
    instituteLabel: slots.instituteLabel,
    filterSummary,
    preferenceEmpty: false,
    includedRows: [],
    stretchRows: [],
    nearestAbove: [],
    coverage: emptyCoverage,
    facts: [],
    interpretation,
    datasetsAvailable: [],
  };

  // Turns that need no evidence get none. An empty evidence set is what keeps
  // a greeting to one line and an out-of-scope question to a short redirect,
  // instead of shipping 6k tokens of cutoff rows the answer will never use.
  if (intent === "greeting" || intent === "identity" || intent === "out_of_scope") {
    return base;
  }
  if (needsGender || needsRank) {
    return base;
  }

  const conversationText = history
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");
  const facts = await selectFacts(intent, `${lastUserMessage}\n${conversationText}`);

  if (intent === "process" || (intent === "college_info" && rank === null)) {
    return { ...base, facts, datasetsAvailable: await availableDatasets() };
  }

  const rows = await loadCutoffRows(seatType, gender, year, round);

  // A preference stated in chat replaces the page multi-select, because it is
  // the more recent intent; page selections still apply when chat is silent.
  const institutes = slots.institutes ?? pageState.selectedInstitutes ?? [];
  const programs = pageState.selectedPrograms ?? [];
  const degrees = slots.degrees ?? pageState.selectedDegrees ?? [];
  const durations = pageState.selectedDurations ?? [];
  const programTypes = slots.programTypes ?? pageState.selectedProgramTypes ?? [];

  const filtered = rows
    .filter((row) => (institutes.length ? institutes.includes(shortenInstituteName(row.institute)) || institutes.includes(row.institute) : true))
    .filter((row) => (programs.length ? programs.includes(row.program) : true))
    .filter((row) => (degrees.length ? degrees.includes(programMeta(row.program).degree) : true))
    .filter((row) => (durations.length ? durations.includes(programMeta(row.program).duration) : true))
    .filter((row) => (programTypes.length ? programTypes.includes(programMeta(row.program).programType) : true))
    .filter((row) => (slots.branch ? slots.branch.matches(row.program) : true));

  const preferenceEmpty = filtered.length === 0 && rows.length > 0;

  const inReach = rank ? filtered.filter((row) => row.closingRankNumber >= rank) : filtered;
  const { picked, institutesAvailable, institutesIncluded } = selectRows(inReach, rank, MAX_ROWS);

  let stretchRows: StretchRow[] = [];
  let nearestAbove: StretchRow[] = [];
  if (rank) {
    const below = filtered
      .filter((row) => row.closingRankNumber < rank)
      .sort((a, b) => b.closingRankNumber - a.closingRankNumber);
    const window = Math.max(150, Math.round(rank * 0.05));
    stretchRows = below
      .filter((row) => row.closingRankNumber >= rank - window)
      .slice(0, MAX_STRETCH)
      .map((row) => toStretchRow(row, rank));
    // When nothing is in reach at all, the honest answer is the closest
    // misses — otherwise the student gets an empty list and no bearings.
    nearestAbove = inReach.length === 0 ? below.slice(0, MAX_STRETCH).map((row) => toStretchRow(row, rank)) : [];
  }

  return {
    ...base,
    preferenceEmpty,
    includedRows: picked,
    stretchRows,
    nearestAbove,
    coverage: {
      totalInReach: inReach.length,
      included: picked.length,
      institutesIncluded,
      institutesAvailable,
      instituteCoverageComplete: institutesIncluded === institutesAvailable,
    },
    facts,
    datasetsAvailable: [],
  };
}
