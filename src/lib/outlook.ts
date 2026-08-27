import type { CutoffResult } from "@/lib/types";

export type Verdict = "safe" | "likely" | "reach";

export type YearClosing = {
  year: number;
  round: number;
  closingRank: number;
  cleared: boolean;
};

export type OutlookRow = {
  id: string;
  institute: string;
  program: string;
  verdict: Verdict;
  closings: YearClosing[];
  tightestClosing: number;
  loosestClosing: number;
  yearsCleared: number;
  yearsObserved: number;
  /** True when only one year of history exists, so "every year" means very little. */
  singleYearOnly: boolean;
};

/**
 * How far past the loosest observed closing rank a row is still worth showing as a reach.
 * Beyond this the answer is simply no, and saying otherwise would overstate the data.
 */
export const REACH_MARGIN = 0.15;

/** The last round of a cycle is the loosest, and the one a candidate actually ends on. */
export function finalRoundByYear(rows: Pick<CutoffResult, "year" | "round">[]) {
  const finalRound = new Map<number, number>();

  for (const row of rows) {
    const current = finalRound.get(row.year);
    if (current === undefined || row.round > current) {
      finalRound.set(row.year, row.round);
    }
  }

  return finalRound;
}

export function classify(rank: number, tightestClosing: number, loosestClosing: number): Verdict {
  if (rank <= tightestClosing) return "safe";
  if (rank <= loosestClosing) return "likely";
  return "reach";
}

/**
 * Collapses per-year closing ranks into one verdict per institute/branch.
 *
 * Only final-round rows are considered, and only non-preparatory ones. Rows further past
 * the loosest closing rank than REACH_MARGIN are dropped rather than listed as hopeless.
 */
export function buildOutlook(rows: CutoffResult[], rank: number): OutlookRow[] {
  const finalRound = finalRoundByYear(rows);
  const grouped = new Map<string, CutoffResult[]>();

  for (const row of rows) {
    if (row.isPreparatory) continue;
    if (finalRound.get(row.year) !== row.round) continue;

    const key = `${row.institute}|${row.program}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(row);
      continue;
    }
    grouped.set(key, [row]);
  }

  const outlook: OutlookRow[] = [];

  for (const [key, group] of grouped) {
    const closings = group
      .map((row) => ({
        year: row.year,
        round: row.round,
        closingRank: row.closingRankNumber,
        cleared: rank <= row.closingRankNumber,
      }))
      .sort((a, b) => a.year - b.year);

    const closingRanks = closings.map((closing) => closing.closingRank);
    const tightestClosing = Math.min(...closingRanks);
    const loosestClosing = Math.max(...closingRanks);
    const verdict = classify(rank, tightestClosing, loosestClosing);

    if (verdict === "reach" && rank > loosestClosing * (1 + REACH_MARGIN)) continue;

    outlook.push({
      id: key,
      institute: group[0].institute,
      program: group[0].program,
      verdict,
      closings,
      tightestClosing,
      loosestClosing,
      yearsCleared: closings.filter((closing) => closing.cleared).length,
      yearsObserved: closings.length,
      singleYearOnly: closings.length < 2,
    });
  }

  return outlook;
}
