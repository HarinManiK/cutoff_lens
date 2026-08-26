import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { CutoffResult, Dataset } from "@/lib/types";

type CsvRow = {
  Institute: string;
  "Academic Program Name": string;
  Quota: string;
  "Seat Type": string;
  Gender: string;
  "Opening Rank": string;
  "Closing Rank": string;
};

const dataDirectory = path.join(process.cwd(), "data");

// data/jee_advanced_<year>_round_<round>_IITs.csv
const csvFileNamePattern = /^jee_advanced_(\d{4})_round_(\d+)_IITs\.csv$/i;

let cachedRows: CutoffResult[] | null = null;

function parseRank(raw: string) {
  const value = raw.trim();
  return {
    raw: value,
    number: Number(value.replace(/P$/, "")),
    isPreparatory: value.endsWith("P"),
  };
}

async function listCsvFiles() {
  const entries = await readdir(dataDirectory);

  return entries
    .map((fileName) => {
      const details = fileName.match(csvFileNamePattern);
      if (!details) return null;

      return {
        fileName,
        year: Number(details[1]),
        round: Number(details[2]),
      };
    })
    .filter((file): file is { fileName: string; year: number; round: number } => file !== null)
    .sort((a, b) => a.year - b.year || a.round - b.round);
}

async function readCsvFile(file: { fileName: string; year: number; round: number }) {
  const csv = await readFile(path.join(dataDirectory, file.fileName));
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  return records.map((row, index) => {
    const opening = parseRank(row["Opening Rank"]);
    const closing = parseRank(row["Closing Rank"]);

    return {
      id: `local-${file.year}-${file.round}-${index}`,
      year: file.year,
      round: file.round,
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
    } satisfies CutoffResult;
  });
}

export async function loadLocalJeeAdvancedCutoffs() {
  if (cachedRows) return cachedRows;

  const files = await listCsvFiles();
  const rowsPerFile = await Promise.all(files.map(readCsvFile));

  cachedRows = rowsPerFile.flat();
  return cachedRows;
}

export async function listLocalJeeAdvancedDatasets(): Promise<Dataset[]> {
  const files = await listCsvFiles();
  return files.map(({ year, round }) => ({ year, round }));
}
