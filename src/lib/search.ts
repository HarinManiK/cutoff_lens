import {
  programMeta,
  programShortName,
  shortenInstituteName,
} from "@/lib/display";
import type { CutoffResult } from "@/lib/types";

type AliasRule = {
  match: string[];
  aliases: string[];
};

const programAliasRules: AliasRule[] = [
  {
    match: ["computer science and engineering"],
    aliases: ["cse", "cs", "computer science", "comp sci"],
  },
  {
    match: ["mathematics and computing"],
    aliases: ["mnc", "maths computing", "math computing", "mathematics computing"],
  },
  {
    match: ["electronics and communication"],
    aliases: ["ece", "electronics communication"],
  },
  {
    match: ["electrical engineering"],
    aliases: ["ee"],
  },
  {
    match: ["electrical and electronics"],
    aliases: ["eee"],
  },
  {
    match: ["mechanical engineering"],
    aliases: ["mech"],
  },
  {
    match: ["chemical engineering"],
    aliases: ["chem"],
  },
  {
    match: ["civil engineering"],
    aliases: ["civil"],
  },
  {
    match: ["aerospace engineering"],
    aliases: ["aero"],
  },
  {
    match: ["artificial intelligence"],
    aliases: ["ai", "artificial intelligence"],
  },
  {
    match: ["data science"],
    aliases: ["ds", "data science"],
  },
  {
    match: ["engineering physics"],
    aliases: ["ep", "physics"],
  },
  {
    match: ["metallurgical", "materials"],
    aliases: ["mme", "metal", "metallurgy", "materials"],
  },
  {
    match: ["biotechnology", "bioscience", "bioengineering"],
    aliases: ["bio", "biotech"],
  },
];

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/gi, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function addSearchValue(words: Set<string>, value: string) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return;

  for (const word of normalized.split(" ")) {
    words.add(word);
  }

  const compact = normalized.replace(/\s+/g, "");
  if (compact.length > 1) {
    words.add(compact);
  }
}

function programAliases(program: string) {
  const normalizedProgram = normalizeSearchText(program);
  return programAliasRules.flatMap((rule) => {
    return rule.match.some((term) => normalizedProgram.includes(term))
      ? rule.aliases
      : [];
  });
}

function cutoffSearchWords(row: CutoffResult) {
  const words = new Set<string>();
  const institute = shortenInstituteName(row.institute);
  const program = programShortName(row.program);
  const meta = programMeta(row.program);

  [
    institute,
    program,
    meta.degree,
    meta.duration,
    meta.programType,
    row.seatType,
    row.quota,
    row.gender,
    String(row.year),
    `round ${row.round}`,
    ...programAliases(program),
  ].forEach((value) => addSearchValue(words, value));

  return [...words];
}

function programSearchWords(program: string) {
  const words = new Set<string>();
  const meta = programMeta(program);

  [
    programShortName(program),
    meta.degree,
    meta.duration,
    meta.programType,
    ...programAliases(program),
  ].forEach((value) => addSearchValue(words, value));

  return [...words];
}

function tokenMatchesWord(token: string, word: string) {
  if (token.length <= 2) {
    return word === token;
  }

  return word.startsWith(token);
}

function wordsMatchSearch(words: string[], query: string) {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;

  return tokens.every((token) => words.some((word) => tokenMatchesWord(token, word)));
}

export function cutoffMatchesSearch(row: CutoffResult, query: string) {
  return wordsMatchSearch(cutoffSearchWords(row), query);
}

export function programMatchesSearch(program: string, query: string) {
  return wordsMatchSearch(programSearchWords(program), query);
}
