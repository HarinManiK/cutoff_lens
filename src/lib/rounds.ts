/** The last round of a cycle is the loosest, and the one a candidate actually ends on. */
export function finalRoundByYear(rows: { year: number; round: number }[]) {
  const finalRound = new Map<number, number>();

  for (const row of rows) {
    const current = finalRound.get(row.year);
    if (current === undefined || row.round > current) {
      finalRound.set(row.year, row.round);
    }
  }

  return finalRound;
}
