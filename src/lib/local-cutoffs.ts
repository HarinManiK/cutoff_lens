import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { CutoffResult } from "@/lib/types";

type CsvRow = {
  Institute: string;
  "Academic Program Name": string;
  Quota: string;
  "Seat Type": string;
  Gender: string;
  "Opening Rank": string;
  "Closing Rank": string;
};

let cachedRows: CutoffResult[] | null = null;

function parseRank(raw: string) {
  const value = raw.trim();
  return {
    raw: value,
    number: Number(value.replace(/P$/, "")),
    isPreparatory: value.endsWith("P"),
  };
}

export async function loadLocalJeeAdvancedCutoffs() {
  if (cachedRows) return cachedRows;

  const csvPath = path.join(process.cwd(), "data", "jee_advanced_2025_round_5_IITs.csv");
  const csv = await readFile(csvPath);
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  cachedRows = records.map((row, index) => {
    const opening = parseRank(row["Opening Rank"]);
    const closing = parseRank(row["Closing Rank"]);

    return {
      id: `local-${index}`,
      year: 2025,
      round: 5,
      institute: row.Institute,
      program: row["Academic Program Name"],
      quota: row.Quota,
      seatType: row["Seat Type"],
      gender: row.Gender,
      openingRankRaw: opening.raw,
      closingRankRaw: closing.raw,
      openingRankNumber: opening.number,
      closingRankNumber: closing.number,
      isPreparatory: opening.isPreparatory || closing.isPreparatory,
    };
  });

  return cachedRows;
}
