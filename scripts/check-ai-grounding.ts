/**
 * Grounding smoke check for the AI counsellor.
 *
 * These are the failures that are invisible from the outside: a corrected rank
 * that never takes effect, a year read as a rank, a branch request that is
 * quietly ignored, or an evidence set that drops two thirds of the IITs before
 * the model ever sees them. Each one produces a confident, wrong answer, so
 * they are asserted rather than eyeballed.
 *
 *   npx tsx scripts/check-ai-grounding.ts
 */
import { buildGroundedContext } from "../src/lib/ai/jee-advanced-context";
import { classifyIntent } from "../src/lib/ai/intent";

type Check = { name: string; run: () => Promise<string | null> | (string | null) };

const ask = (turns: string[]) =>
  buildGroundedContext(
    turns[turns.length - 1],
    {},
    turns.map((content) => ({ role: "user" as const, content })),
  );

const checks: Check[] = [
  {
    name: "a year in the question is not read as a rank",
    run: async () => {
      const ctx = await ask(["which colleges can I get in 2026?"]);
      return ctx.rank === null ? null : `read rank ${ctx.rank}`;
    },
  },
  {
    name: "a corrected rank replaces the earlier one",
    run: async () => {
      const ctx = await ask(["rank 50000, open, male", "oops my rank is 5000"]);
      return ctx.rank === 5000 ? null : `kept rank ${ctx.rank}`;
    },
  },
  {
    name: "a corrected gender replaces the earlier one",
    run: async () => {
      const ctx = await ask(["rank 2500 sc female", "actually male"]);
      return ctx.gender === "Male" ? null : `kept gender ${ctx.gender}`;
    },
  },
  {
    name: "a corrected category replaces the earlier one, in both directions",
    run: async () => {
      const toObc = await ask(["I'm SC, rank 5000, male", "actually I'm OBC-NCL"]);
      const toSc = await ask(["I'm OBC-NCL, rank 5000, male", "actually I'm SC"]);
      if (toObc.seatType !== "OBC-NCL") return `SC->OBC kept ${toObc.seatType}`;
      return toSc.seatType === "SC" ? null : `OBC->SC kept ${toSc.seatType}`;
    },
  },
  {
    name: "a branch request filters the evidence",
    run: async () => {
      const ctx = await ask(["2500 rank, sc, female. best picks? I want only physics related branches."]);
      if (ctx.branchLabel === null) return "no branch preference detected";
      const stray = ctx.includedRows.find((row) => !/physic|engineering science/i.test(row.branch));
      return stray ? `included unrelated branch ${stray.branch}` : null;
    },
  },
  {
    name: "every institute with a match is represented in the evidence",
    run: async () => {
      const ctx = await ask(["2500 rank, sc, female, best picks"]);
      return ctx.coverage.instituteCoverageComplete
        ? null
        : `only ${ctx.coverage.institutesIncluded} of ${ctx.coverage.institutesAvailable} institutes`;
    },
  },
  {
    name: "gender is asked for rather than defaulted",
    run: async () => {
      const ctx = await ask(["rank 2500, sc, best options?"]);
      return ctx.needsGender && ctx.includedRows.length === 0 ? null : "answered from a defaulted seat pool";
    },
  },
  {
    name: "turns that need no evidence get none",
    run: async () => {
      for (const turn of ["hi", "thanks!", "who are you?", "write me a python quicksort"]) {
        const ctx = await ask([turn]);
        if (ctx.includedRows.length > 0 || ctx.facts.length > 0) return `"${turn}" loaded evidence`;
      }
      return null;
    },
  },
  {
    name: "a pure cutoff question carries no unrelated citations",
    run: async () => {
      const ctx = await ask(["rank 2500 sc female best picks"]);
      return ctx.facts.length === 0 ? null : `attached ${ctx.facts.length} facts`;
    },
  },
  {
    name: "degree wording is not mistaken for a branch filter",
    run: async () => {
      const ctx = await ask(["2700 rank, sc, male", "what are my best picks? I just want a BTech degree"]);
      if (ctx.branchLabel !== null) return `bogus branch filter ${ctx.branchLabel}`;
      return ctx.coverage.totalInReach > 0 ? null : "degree filter wiped every row";
    },
  },
  {
    name: "intents route correctly",
    run: () => {
      const cases: Array<[string, boolean, string]> = [
        ["how are placements at IIT Goa?", true, "college_info"],
        ["what is JoSAA", false, "process"],
        ["can I get CSE at IIT Goa with 4000", true, "cutoff_options"],
        ["hi", false, "greeting"],
        ["who are you?", false, "identity"],
        ["write me a python quicksort", false, "out_of_scope"],
      ];
      for (const [text, hasRank, expected] of cases) {
        const actual = classifyIntent(text, hasRank);
        if (actual !== expected) return `"${text}" -> ${actual}, expected ${expected}`;
      }
      return null;
    },
  },
];

let failed = 0;
for (const check of checks) {
  const problem = await check.run();
  if (problem) {
    failed += 1;
    console.error(`FAIL  ${check.name}\n      ${problem}`);
  } else {
    console.log(`ok    ${check.name}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed > 0 ? 1 : 0);
