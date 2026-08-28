import { finalRoundByYear } from "@/lib/rounds";
import type { CutoffResult } from "@/lib/types";

export type YearClosing = {
  year: number;
  round: number;
  closingRank: number;
};

export type CategoryClosing = {
  seatType: string;
  closingRank: number;
};

export type PairInsights = {
  institute: string;
  program: string;
  seatType: string;
  gender: string;
  year: number;
  round: number;
  /** Where this branch sits among all branches at this institute, hardest first. */
  rankWithinInstitute: { position: number; outOf: number } | null;
  /** Where this institute's version sits among every institute offering the branch. */
  rankAcrossInstitutes: { position: number; outOf: number } | null;
  /** Closing rank at the last round of each year on record. */
  closingByYear: YearClosing[];
  /** How far the closing rank moved between the first and last round of the selected year. */
  roundMovement: { firstRound: number; lastRound: number; from: number; to: number } | null;
  /** The same seat at every seat type, so the category difference is visible. */
  closingByCategory: CategoryClosing[];
  institutesOfferingBranch: number;
};

function isSameProgram(a: string, b: string) {
  return a.trim() === b.trim();
}

/**
 * `scope` holds every row for the selected year, round, seat type and gender, which is what
 * the two rankings are computed against. `history` holds every row for this institute and
 * programme across all years, rounds and seat types at the selected gender.
 */
export function buildPairInsights({
  institute,
  program,
  seatType,
  gender,
  year,
  round,
  scope,
  history,
}: {
  institute: string;
  program: string;
  seatType: string;
  gender: string;
  year: number;
  round: number;
  scope: CutoffResult[];
  history: CutoffResult[];
}): PairInsights {
  const usable = scope.filter((row) => !row.isPreparatory);

  // Hardest branch first, so position 1 is the most competitive at that institute.
  const atInstitute = usable
    .filter((row) => row.institute === institute)
    .sort((a, b) => a.closingRankNumber - b.closingRankNumber);
  const withinIndex = atInstitute.findIndex((row) => isSameProgram(row.program, program));

  const offeringBranch = usable
    .filter((row) => isSameProgram(row.program, program))
    .sort((a, b) => a.closingRankNumber - b.closingRankNumber);
  const acrossIndex = offeringBranch.findIndex((row) => row.institute === institute);

  const pairHistory = history.filter(
    (row) => row.institute === institute && isSameProgram(row.program, program) && !row.isPreparatory,
  );

  const finalRound = finalRoundByYear(pairHistory);
  const closingByYear = pairHistory
    .filter((row) => row.seatType === seatType && finalRound.get(row.year) === row.round)
    .map((row) => ({ year: row.year, round: row.round, closingRank: row.closingRankNumber }))
    .sort((a, b) => a.year - b.year);

  const thisYear = pairHistory
    .filter((row) => row.year === year && row.seatType === seatType)
    .sort((a, b) => a.round - b.round);
  const roundMovement =
    thisYear.length > 1
      ? {
          firstRound: thisYear[0].round,
          lastRound: thisYear[thisYear.length - 1].round,
          from: thisYear[0].closingRankNumber,
          to: thisYear[thisYear.length - 1].closingRankNumber,
        }
      : null;

  const closingByCategory = pairHistory
    .filter((row) => row.year === year && row.round === round)
    .map((row) => ({ seatType: row.seatType, closingRank: row.closingRankNumber }))
    .sort((a, b) => a.closingRank - b.closingRank);

  return {
    institute,
    program,
    seatType,
    gender,
    year,
    round,
    rankWithinInstitute:
      withinIndex >= 0 ? { position: withinIndex + 1, outOf: atInstitute.length } : null,
    rankAcrossInstitutes:
      acrossIndex >= 0 ? { position: acrossIndex + 1, outOf: offeringBranch.length } : null,
    closingByYear,
    roundMovement,
    closingByCategory,
    institutesOfferingBranch: offeringBranch.length,
  };
}
