import { branchGroups } from "@/lib/branch-groups";
import { normalizeSearchText, programMatchesSearch } from "@/lib/search";
import { seatTypes } from "@/lib/display";
import type { GenderFilter } from "@/lib/types";

// Everything the chat can learn from the conversation itself, extracted once
// and reused by the evidence builder, the prompt and the deterministic answer.
//
// The rule that shapes this whole module: a student corrects themselves. They
// say "rank 50000" and then "oops, 5000"; they say "female" and then "actually
// male". Reading the transcript as one concatenated blob — which is what the
// old extractor did — makes the *first* mention win forever, so a correction
// silently does nothing and the student is answered from the wrong seat pool.
// Every slot here is therefore resolved newest-message-first.

export type AiChatMessage = { role: "user" | "assistant"; content: string };

export type Intent =
  | "greeting"
  | "identity"
  | "out_of_scope"
  | "cutoff_options"
  | "college_info"
  | "process";

export type BranchPreference = {
  // Human label for the prompt and the fallback ("physics-related").
  label: string;
  // Match against the raw JoSAA program name.
  matches: (program: string) => boolean;
};

export type Slots = {
  rank: number | null;
  rankSource: "message" | "page" | null;
  seatType: string | null;
  gender: GenderFilter | null;
  year: number | null;
  round: number | null;
  degrees: string[] | null;
  programTypes: string[] | null;
  degreeLabel: string | null;
  branch: BranchPreference | null;
  institutes: string[] | null;
  instituteLabel: string | null;
};

const MIN_RANK = 1;
const MAX_RANK = 1_500_000;

// Spans that look like ranks but are not. Masked before any number is read as
// a rank, so "which colleges in 2026" stops resolving to rank 2,026.
function maskNonRankNumbers(text: string) {
  return text
    .replace(/\b(19|20)\d{2}\b/g, " <year> ")
    .replace(/\btop\s*\d{1,3}\b/gi, " <count> ")
    .replace(/\bround\s*-?\s*\d{1,2}\b/gi, " <round> ")
    .replace(/\br\s?[1-9]\b/gi, " <round> ")
    .replace(/\btop\s*\d{1,3}\s*(%|percent|percentile)/gi, " <pct> ")
    .replace(/\b\d{1,3}\s*(%|percent|percentile)\b/gi, " <pct> ")
    .replace(/\bclass\s*\d{1,2}\b/gi, " <class> ")
    .replace(/\b\d{1,2}(st|nd|rd|th)\b/gi, " <ordinal> ")
    .replace(/\b\d{10,}\b/g, " <long> ");
}

function toRank(raw: string, suffix?: string) {
  const digits = Number(raw.replace(/[,\s]/g, ""));
  if (!Number.isFinite(digits) || digits <= 0) return null;
  const scale = suffix?.toLowerCase().startsWith("l") ? 100_000 : suffix?.toLowerCase() === "k" ? 1_000 : 1;
  const value = Math.round(digits * scale);
  return value >= MIN_RANK && value <= MAX_RANK ? value : null;
}

// "AIR 1234", "rank 1234", "1234 rank", "got 5k", "1.2 lakh", "rank of 900".
export function rankFromMessage(message: string): number | null {
  const text = maskNonRankNumbers(message);

  const labelled = text.match(
    /\b(?:rank|air|crl|score)\b[^0-9\n]{0,24}(\d[\d,]*(?:\.\d+)?)\s*(k|lakh|lac|l)?\b/i,
  );
  if (labelled) {
    const value = toRank(labelled[1], labelled[2]);
    if (value) return value;
  }

  const trailing = text.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(k|lakh|lac|l)?\s*(?:rank|air|crl)\b/i);
  if (trailing) {
    const value = toRank(trailing[1], trailing[2]);
    if (value) return value;
  }

  // Bare number, only when the sentence is clearly about a result or a seat.
  const contextual =
    /\b(got|getting|scored|secured|i\s?am|i'?m|with|have|options?|colleges?|college|admission|seat|chances?|eligible|picks?|branch|category|male|female|open|general|obc|ews|sc|st|pwd)\b/i.test(
      message,
    );
  if (!contextual) return null;
  const bare = text.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(k|lakh|lac|l)?\b/i);
  return bare ? toRank(bare[1], bare[2]) : null;
}

// Category tokens with their position, so the *last* one in a sentence wins:
// "not OBC, I'm SC" resolves to SC.
const SEAT_PATTERNS: Array<{ pattern: RegExp; base: string }> = [
  { pattern: /\bobc(?:[-\s]?ncl)?\b/gi, base: "OBC-NCL" },
  { pattern: /\bews\b/gi, base: "EWS" },
  { pattern: /\bsc\b/gi, base: "SC" },
  { pattern: /\bst\b/gi, base: "ST" },
  { pattern: /\b(?:open|crl|general|gen)\b/gi, base: "OPEN" },
];

export function seatTypeFromMessage(message: string): string | null {
  const pwd = /\bpwd\b|\bdivyang\b|\bdisab/i.test(message);
  let best: { index: number; base: string } | null = null;
  for (const { pattern, base } of SEAT_PATTERNS) {
    for (const match of message.matchAll(pattern)) {
      const index = match.index ?? 0;
      // "not SC" / "not OBC" is a rule-out, not a claim.
      if (/\b(not|isn'?t|neither)\s+\S{0,6}$/i.test(message.slice(Math.max(0, index - 12), index))) continue;
      if (!best || index > best.index) best = { index, base };
    }
  }
  if (!best) return null;
  const candidate = pwd ? `${best.base} (PwD)` : best.base;
  return seatTypes.includes(candidate) ? candidate : seatTypes.includes(best.base) ? best.base : null;
}

export function genderFromMessage(message: string): GenderFilter | null {
  const female = message.search(/\b(female|girl|woman|women|daughter|she\/her)\b/i);
  const male = message.search(/\b(male|boy|man|men|son|gender[-\s]?neutral|he\/him)\b/i);
  // "female" contains "male", so a bare male hit that sits inside a female hit
  // is not a male mention. Compare positions to pick the later, real mention.
  const realMale = male >= 0 && !(female >= 0 && male === female + 2) ? male : -1;
  if (female < 0 && realMale < 0) return null;
  if (realMale < 0) return "Female";
  if (female < 0) return "Male";
  return realMale > female ? "Male" : "Female";
}

export function yearFromMessage(message: string): number | null {
  const match = message.match(/\b(20[2-9]\d)\b/);
  const year = match ? Number(match[1]) : null;
  return year && year >= 2015 && year <= 2035 ? year : null;
}

export function roundFromMessage(message: string): number | null {
  const match = message.match(/\bround\s*-?\s*(\d{1,2})\b/i) ?? message.match(/\br([1-6])\b/i);
  const round = match ? Number(match[1]) : null;
  return round && round >= 1 && round <= 12 ? round : null;
}

// --- Degree / program type -------------------------------------------------

const DEGREE_RULES: Array<{ pattern: RegExp; degree: string }> = [
  { pattern: /\bb\.?\s?tech\b|\bbtech\b|\bbachelor of technology\b/i, degree: "B.Tech" },
  { pattern: /\bb\.?\s?s\.?\b(?!\s?c)|\bbsc\b|\bbachelor of science\b/i, degree: "B.S." },
  { pattern: /\bb\.?\s?arch\b|\bbarch\b|\barchitecture degree\b/i, degree: "B.Arch" },
];

function degreePreferenceFromMessage(message: string) {
  // Dual-degree wording must not be read as a plain B.Tech request.
  const wantsDual = /\bdual\s+degree\b|\bb\.?\s?tech\s*\+\s*m\.?\s?tech\b|\bintegrated\b/i.test(message);
  const rejectsDual = /\bno\s+dual\b|\bwithout\s+dual\b|\bnot?\s+dual\b|\bsingle\s+degree\b|\b4[\s-]?year\s+(?:only|course|program)/i.test(message);
  const cleaned = message.replace(/b\.?\s?tech\s*\+\s*m\.?\s?tech/gi, " ").replace(/dual\s+degree/gi, " ");

  const degrees = DEGREE_RULES.filter((rule) => rule.pattern.test(cleaned)).map((rule) => rule.degree);

  const programTypes = rejectsDual
    ? ["Single Degree"]
    : wantsDual && degrees.length === 0
      ? ["Dual Degree", "Integrated", "MBA Dual Degree"]
      : null;

  if (degrees.length === 0 && !programTypes) {
    return { degrees: null, programTypes: null, label: null };
  }
  const label = [
    degrees.length > 0 ? degrees.join(" or ").replace(/\./g, "") : null,
    rejectsDual ? "single-degree" : wantsDual && degrees.length === 0 ? "dual-degree" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return { degrees: degrees.length > 0 ? degrees : null, programTypes, label: label || null };
}

// --- Branch / subject ------------------------------------------------------

// Phrases that map onto the bulk-select groups the Branch filter already uses,
// so chat and the UI agree on what "physics" or "circuit branches" covers.
const GROUP_TRIGGERS: Array<{ label: string; group: string; patterns: RegExp[] }> = [
  { label: "physics-related", group: "Physics", patterns: [/\bphysics\b/i, /\bengineering science\b/i, /\bphysical science\b/i] },
  { label: "computing-related", group: "Computer", patterns: [/\bcse\b/i, /\bcomputer\b/i, /\bcomputing\b/i, /\bsoftware\b/i, /\b(ai|artificial intelligence)\b/i, /\bdata science\b/i, /\bml\b/i] },
  { label: "electrical/electronics", group: "Electrical", patterns: [/\bece\b/i, /\bee\b/i, /\belectrical\b/i, /\belectronics\b/i, /\bvlsi\b/i, /\bcommunication\b/i] },
  { label: "mechanical-related", group: "Mechanical", patterns: [/\bmech(anical)?\b/i, /\bmanufacturing\b/i, /\bindustrial\b/i] },
  { label: "civil/architecture", group: "Civil", patterns: [/\bcivil\b/i, /\barchitecture\b/i, /\binfrastructure\b/i] },
  { label: "chemical/chemistry", group: "Chemical", patterns: [/\bchemical\b/i, /\bchemistry\b/i] },
  { label: "materials/metallurgy", group: "Materials", patterns: [/\bmetallurg/i, /\bmaterials?\b/i, /\bmme\b/i, /\bceramic\b/i] },
  { label: "aerospace/ocean", group: "Aerospace", patterns: [/\baero(space|nautical)?\b/i, /\bspace\b/i, /\bnaval\b/i, /\bocean\b/i] },
  { label: "bio-related", group: "Bio", patterns: [/\bbio(tech|technology|medical|engineering|logical)?\b/i] },
  { label: "earth/mining/petroleum", group: "Earth", patterns: [/\bmining\b/i, /\bpetroleum\b/i, /\bgeolog/i, /\bgeophysic/i, /\bearth science/i] },
  { label: "energy/environment", group: "Energy", patterns: [/\benergy\b/i, /\benvironment/i] },
  { label: "maths-related", group: "Computer", patterns: [/\bmaths?\b/i, /\bmathematics\b/i, /\bmnc\b/i] },
];

// Curated multi-group shorthands students actually use.
const COMPOSITE_TRIGGERS: Array<{ label: string; pattern: RegExp; groups: string[] }> = [
  { label: "circuit branches", pattern: /\bcircuit(al)?\s+branch/i, groups: ["Computer", "Electrical"] },
  { label: "core branches", pattern: /\bcore\s+branch|\bcore\s+engineering\b/i, groups: ["Mechanical", "Civil", "Chemical", "Electrical", "Materials"] },
  { label: "pure science (B.S.)", pattern: /\bpure\s+science|\bbasic\s+science|\bscience\s+branch/i, groups: ["Physics", "Chemical", "Bio", "Earth"] },
];

function groupMatcher(groupKeys: string[]) {
  const rules = branchGroups.filter((group) => groupKeys.some((key) => group.label.includes(key)));
  return (program: string) => rules.some((rule) => rule.matches(program));
}

export function branchPreferenceFromMessage(message: string): BranchPreference | null {
  // "any branch" / "open to anything" explicitly clears a preference.
  if (/\bany (branch|stream|course)\b|\bopen to (any|all)\b|\bno preference\b/i.test(message)) return null;

  for (const { label, pattern, groups } of COMPOSITE_TRIGGERS) {
    if (pattern.test(message)) return { label, matches: groupMatcher(groups) };
  }

  const hits = GROUP_TRIGGERS.filter(({ patterns }) => patterns.some((pattern) => pattern.test(message)));
  if (hits.length > 0) {
    const groups = [...new Set(hits.map((hit) => hit.group))];
    const label = hits.map((hit) => hit.label).join(" / ");
    return { label, matches: groupMatcher(groups) };
  }

  // Fall back to the same alias-aware search the results table uses, so a
  // named branch ("naval architecture", "engineering design") still filters.
  // Degree wording is stripped first: without this, "I just want a BTech
  // degree" captures "want a BTech degree" as a branch, matches no program,
  // and silently deletes every row from the evidence.
  const quoted = message.match(/\b(?:in|for|only|just|want|prefer|interested in)\s+([a-z][a-z\s&+.-]{3,40}?)\s*(?:branch|engineering|\.|,|\?|$)/i);
  const candidate = quoted?.[1]
    ?.replace(/\b(b\.?\s?tech|b\.?\s?s\.?|b\.?\s?arch|m\.?\s?tech|degree|program(me)?|course|stream|colleges?|options?|picks?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^(want|prefer|like|need|get|take|a|an|the|just|only|for|in|my|some|good|best|top)\b\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (candidate && normalizeSearchText(candidate).split(" ").length <= 4) {
    const normalized = normalizeSearchText(candidate);
    if (normalized.length >= 3 && !/^(the|best|good|top|any|some|my|a|an)$/.test(normalized)) {
      return { label: candidate, matches: (program: string) => programMatchesSearch(program, candidate) };
    }
  }
  return null;
}

// --- Institutes ------------------------------------------------------------

const INSTITUTE_TOKENS: Array<{ token: RegExp; institute: string }> = [
  { token: /\bbombay\b|\bmumbai\b/i, institute: "IIT Bombay" },
  { token: /\bdelhi\b/i, institute: "IIT Delhi" },
  { token: /\bmadras\b|\bchennai\b/i, institute: "IIT Madras" },
  { token: /\bkanpur\b/i, institute: "IIT Kanpur" },
  { token: /\bkharagpur\b|\bkgp\b/i, institute: "IIT Kharagpur" },
  { token: /\broorkee\b/i, institute: "IIT Roorkee" },
  { token: /\bguwahati\b/i, institute: "IIT Guwahati" },
  { token: /\bhyderabad\b/i, institute: "IIT Hyderabad" },
  { token: /\bbhu\b|\bvaranasi\b|\bbanaras\b/i, institute: "IIT (BHU) Varanasi" },
  { token: /\bindore\b/i, institute: "IIT Indore" },
  { token: /\bdhanbad\b|\bism\b/i, institute: "IIT (ISM) Dhanbad" },
  { token: /\bpatna\b/i, institute: "IIT Patna" },
  { token: /\bgandhinagar\b/i, institute: "IIT Gandhinagar" },
  { token: /\bmandi\b/i, institute: "IIT Mandi" },
  { token: /\bjodhpur\b/i, institute: "IIT Jodhpur" },
  { token: /\bropar\b/i, institute: "IIT Ropar" },
  { token: /\bbhubaneswar\b/i, institute: "IIT Bhubaneswar" },
  { token: /\bjammu\b/i, institute: "IIT Jammu" },
  { token: /\btirupati\b/i, institute: "IIT Tirupati" },
  { token: /\bpalakkad\b/i, institute: "IIT Palakkad" },
  { token: /\bbhilai\b/i, institute: "IIT Bhilai" },
  { token: /\bdharwad\b/i, institute: "IIT Dharwad" },
  { token: /\bgoa\b/i, institute: "IIT Goa" },
];

const OLD_IITS = [
  "IIT Bombay", "IIT Delhi", "IIT Madras", "IIT Kanpur",
  "IIT Kharagpur", "IIT Roorkee", "IIT Guwahati",
];

export function institutesFromMessage(message: string) {
  const named = INSTITUTE_TOKENS.filter(({ token }) => token.test(message)).map((entry) => entry.institute);
  if (/\bold\s+iits?\b|\btop\s*(5|7|seven|five)\b|\blegacy iits?\b/i.test(message)) {
    return { institutes: OLD_IITS, label: "old IITs" };
  }
  if (/\bnew\s+iits?\b/i.test(message)) {
    const newer = INSTITUTE_TOKENS.map((entry) => entry.institute).filter((name) => !OLD_IITS.includes(name));
    return { institutes: newer, label: "newer IITs" };
  }
  if (named.length === 0) return { institutes: null, label: null };
  return { institutes: named, label: named.join(", ") };
}

export function mentionedInstitutes(message: string) {
  return INSTITUTE_TOKENS.filter(({ token }) => token.test(message)).map((entry) => entry.institute);
}

// --- Intent ----------------------------------------------------------------

const GREETING = /^(hi+|hey+|hello+|namaste|namaskar|yo|sup|hola|howdy|good\s?(morning|afternoon|evening|day)|how\s?are\s?(you|u)|thanks?|thank\s?you|thx|ty|ok(ay)?|cool|nice|great|got\s?it|bye|see\s?ya|gn|gm)[\s!.,?😊🙏👍]*$/i;

const IDENTITY = /\b(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|how\s+do\s+you\s+work|are\s+you\s+(an?\s+)?(ai|bot|human|chatgpt)|your\s+name)\b/i;

const PROCESS =
  /\b(josaa|csab|counselling|counseling|seat matrix|business rules?|supernumerary|de-?reservation|floats?|freeze|slide|willingness|reporting|document verification|mock (seat )?allot|how (many|do) rounds?|what is (a )?round|choice filling|locking|top 20 percentile|category certificates?|preparatory)\b/i;

// Stems are written to tolerate plurals: /\bplacement\b/ silently fails on
// "placements", which is how a plain placements question used to fall through
// to the cutoff branch and get answered with sixty rows of ranks.
const COLLEGE_INFO =
  /\b(placements?|packages?|ctc|salar(y|ies)|medians?|averages?|recruit\w*|intern\w*|fees?|tuition|scholarships?|hostels?|mess|campus\w*|curricul\w*|syllabus|branch change|grading|cgpa|minors?|honou?rs|double major|start-?ups?|incubat\w*|e-?cell|entrepreneur\w*|facult\w*|research|clubs?|fests?|ragging|counsell?ors?|mental health|life at|what.{0,12}like)\b/i;

const CUTOFF =
  /\b(ranks?|air|crl|cut-?offs?|closing|opening|chances?|options?|picks?|colleges?|branch(es)?|admissions?|seats?|eligible|get into|can i get|best pick|safe|reach|categor(y|ies)|obc|ews|sc|st|pwd|open|general|male|female)\b|\b\d{2,7}\b/i;

// Signals the message is about something this product has no data for at all.
const OUT_OF_SCOPE_TOPIC =
  /\b(python|javascript|java|c\+\+|code|coding|programs?\b.{0,10}\b(write|in)|leetcode|recipes?|weather|movies?|cricket|football|songs?|lyrics|poems?|essays?|homework|solve this|integral|derivative|translate)\b/i;

export function classifyIntent(message: string, hasRankContext: boolean): Intent {
  const text = message.trim();
  if (!text) return "greeting";
  if (text.length <= 60 && GREETING.test(text.replace(/\s+/g, " "))) return "greeting";
  if (IDENTITY.test(text)) return "identity";

  const asksCutoff = CUTOFF.test(text);
  const asksCollege = COLLEGE_INFO.test(text);
  const asksProcess = PROCESS.test(text);
  const namesInstitute = mentionedInstitutes(text).length > 0;

  if (OUT_OF_SCOPE_TOPIC.test(text) && !asksCutoff && !asksCollege && !asksProcess) {
    return "out_of_scope";
  }

  // A college question carrying an eligibility phrasing is a cutoff question:
  // "can I get IIT Goa CSE at 4000" needs rows, not brochures.
  const asksEligibility = /\b(can i|will i|do i|chances?|cut-?offs?|closing|opening|options?|which (colleges?|branch))\b/i.test(text);
  if (asksCollege && !asksEligibility) return "college_info";
  if (asksProcess && !asksEligibility) return "process";
  if (asksCutoff || hasRankContext) return "cutoff_options";
  // A bare institute name with no other signal is a question about that
  // college, not an off-topic message.
  if (namesInstitute) return "college_info";
  if (asksProcess) return "process";
  return "out_of_scope";
}

// --- Slot resolution across the transcript ---------------------------------

function newestFirst(messages: AiChatMessage[]) {
  return messages.filter((message) => message.role === "user").map((message) => message.content).reverse();
}

function firstHit<T>(texts: string[], read: (text: string) => T | null): T | null {
  for (const text of texts) {
    const value = read(text);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

export function resolveSlots(messages: AiChatMessage[]): Slots {
  const texts = newestFirst(messages);
  const degreeHit = firstHit(texts, (text) => {
    const preference = degreePreferenceFromMessage(text);
    return preference.degrees || preference.programTypes ? preference : null;
  });
  const instituteHit = firstHit(texts, (text) => {
    const found = institutesFromMessage(text);
    return found.institutes ? found : null;
  });

  return {
    rank: firstHit(texts, rankFromMessage),
    rankSource: null,
    seatType: firstHit(texts, seatTypeFromMessage),
    gender: firstHit(texts, genderFromMessage),
    year: firstHit(texts, yearFromMessage),
    round: firstHit(texts, roundFromMessage),
    degrees: degreeHit?.degrees ?? null,
    programTypes: degreeHit?.programTypes ?? null,
    degreeLabel: degreeHit?.label ?? null,
    branch: firstHit(texts, branchPreferenceFromMessage),
    institutes: instituteHit?.institutes ?? null,
    instituteLabel: instituteHit?.label ?? null,
  };
}
