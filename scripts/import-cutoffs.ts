import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });
dotenv.config();

type CsvRow = {
  Institute: string;
  "Academic Program Name": string;
  Quota: string;
  "Seat Type": string;
  Gender: string;
  "Opening Rank": string;
  "Closing Rank": string;
};

type SourceFile = {
  csvPath: string;
  year: number;
  round: number;
  instituteType: string;
};

type CliOptions = {
  files: SourceFile[];
  exam: string;
  examName: string;
};

const dataDirectory = path.join(process.cwd(), "data");

// jee_advanced_<year>_round_<round>_<instituteType>s.csv
const csvFileNamePattern = /^jee_advanced_(\d{4})_round_(\d+)_(.+)\.csv$/i;

function describeFile(csvPath: string, overrides: Map<string, string>): SourceFile {
  const fileName = path.basename(csvPath);
  const details = fileName.match(csvFileNamePattern);
  const year = Number(overrides.get("year") ?? details?.[1]);
  const round = Number(overrides.get("round") ?? details?.[2]);

  if (!Number.isInteger(year) || !Number.isInteger(round)) {
    throw new Error(
      `Cannot determine year/round for ${fileName}. Rename it to jee_advanced_<year>_round_<round>_IITs.csv or pass --year and --round.`,
    );
  }

  return {
    csvPath,
    year,
    round,
    instituteType: overrides.get("institute-type") ?? details?.[3]?.replace(/s$/i, "") ?? "IIT",
  };
}

async function discoverDataDirectory() {
  const entries = await readdir(dataDirectory);
  const matching = entries.filter((entry) => csvFileNamePattern.test(entry));

  if (matching.length === 0) {
    throw new Error(`No matching CSVs found in ${dataDirectory}.`);
  }

  return matching.sort().map((entry) => path.join(dataDirectory, entry));
}

async function parseArgs(argv: string[]): Promise<CliOptions> {
  const overrides = new Map<string, string>();
  const paths: string[] = [];

  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [rawKey, ...rawValue] = arg.replace(/^--/, "").split("=");
      overrides.set(rawKey, rawValue.join("="));
      continue;
    }

    paths.push(arg);
  }

  const csvPaths = paths.length > 0 ? paths : await discoverDataDirectory();

  return {
    files: csvPaths.map((csvPath) => describeFile(csvPath, overrides)),
    exam: overrides.get("exam") ?? "jee-advanced",
    examName: overrides.get("exam-name") ?? "JEE Advanced",
  };
}

function parseRank(raw: string) {
  const value = raw.trim();
  const isPreparatory = value.endsWith("P");
  const rankNumber = Number(value.replace(/P$/, ""));

  if (!Number.isInteger(rankNumber) || rankNumber < 0) {
    throw new Error(`Invalid rank value: ${raw}`);
  }

  return { raw: value, rankNumber, isPreparatory };
}

function createImportClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

type ImportClient = ReturnType<typeof createImportClient>;

async function importFile(supabase: ImportClient, examId: string, file: SourceFile) {
  const absoluteCsvPath = path.resolve(file.csvPath);
  const fileName = path.basename(absoluteCsvPath);
  const fileBuffer = await readFile(absoluteCsvPath);
  const sourceSha256 = createHash("sha256").update(fileBuffer).digest("hex");

  const rows = parse(fileBuffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  const { data: existingSource, error: existingSourceError } = await supabase
    .from("counselling_sources")
    .select("id, row_count")
    .eq("source_sha256", sourceSha256)
    .maybeSingle();

  if (existingSourceError) {
    throw new Error(`Unable to inspect source: ${existingSourceError.message}`);
  }

  if (existingSource && existingSource.row_count > 0) {
    console.log(`- ${fileName}: already imported (${existingSource.row_count} rows), skipping.`);
    return 0;
  }

  const { data: source, error: sourceError } = await supabase
    .from("counselling_sources")
    .upsert(
      {
        exam_id: examId,
        year: file.year,
        round: file.round,
        institute_type: file.instituteType,
        source_file_name: fileName,
        source_sha256: sourceSha256,
        row_count: 0,
      },
      { onConflict: "source_sha256" },
    )
    .select("id")
    .single();

  if (sourceError || !source) {
    throw new Error(`Unable to create source for ${fileName}: ${sourceError?.message}`);
  }

  const instituteNames = [...new Set(rows.map((row) => row.Institute.trim()))];
  const programNames = [...new Set(rows.map((row) => row["Academic Program Name"].trim()))];

  const { data: institutes, error: institutesError } = await supabase
    .from("institutes")
    .upsert(instituteNames.map((name) => ({ name })), { onConflict: "name" })
    .select("id, name");

  if (institutesError || !institutes) {
    throw new Error(`Unable to upsert institutes: ${institutesError?.message}`);
  }

  const { data: programs, error: programsError } = await supabase
    .from("programs")
    .upsert(programNames.map((name) => ({ name })), { onConflict: "name" })
    .select("id, name");

  if (programsError || !programs) {
    throw new Error(`Unable to upsert programs: ${programsError?.message}`);
  }

  const instituteIdByName = new Map(institutes.map((item) => [item.name, item.id]));
  const programIdByName = new Map(programs.map((item) => [item.name, item.id]));

  const cutoffs = rows.map((row) => {
    const opening = parseRank(row["Opening Rank"]);
    const closing = parseRank(row["Closing Rank"]);
    const instituteName = row.Institute.trim();
    const programName = row["Academic Program Name"].trim();
    const instituteId = instituteIdByName.get(instituteName);
    const programId = programIdByName.get(programName);

    if (!instituteId || !programId) {
      throw new Error(`Missing dimension id for ${instituteName} / ${programName}`);
    }

    return {
      source_id: source.id,
      exam_id: examId,
      institute_id: instituteId,
      program_id: programId,
      year: file.year,
      round: file.round,
      quota: row.Quota.trim(),
      seat_type: row["Seat Type"].trim(),
      gender: row.Gender.trim(),
      opening_rank_raw: opening.raw,
      closing_rank_raw: closing.raw,
      opening_rank_number: opening.rankNumber,
      closing_rank_number: closing.rankNumber,
      is_preparatory: opening.isPreparatory || closing.isPreparatory,
    };
  });

  for (let start = 0; start < cutoffs.length; start += 500) {
    const chunk = cutoffs.slice(start, start + 500);
    const { error } = await supabase.from("cutoffs").insert(chunk);

    if (error) {
      throw new Error(`Unable to insert rows ${start + 1}-${start + chunk.length} of ${fileName}: ${error.message}`);
    }
  }

  const { error: updateSourceError } = await supabase
    .from("counselling_sources")
    .update({ row_count: rows.length })
    .eq("id", source.id);

  if (updateSourceError) {
    throw new Error(`Unable to update source row count: ${updateSourceError.message}`);
  }

  console.log(`- ${fileName}: imported ${rows.length} rows (${file.year} round ${file.round}, ${file.instituteType}).`);
  return rows.length;
}

async function main() {
  const options = await parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before importing.");
  }

  const supabase = createImportClient(supabaseUrl, serviceRoleKey);

  const { data: exam, error: examError } = await supabase
    .from("exams")
    .upsert({ slug: options.exam, name: options.examName }, { onConflict: "slug" })
    .select("id")
    .single();

  if (examError || !exam) {
    throw new Error(`Unable to upsert exam: ${examError?.message}`);
  }

  console.log(`Importing ${options.files.length} file(s) for ${options.examName}:`);

  let imported = 0;
  for (const file of options.files) {
    imported += await importFile(supabase, exam.id, file);
  }

  console.log(`Done. ${imported} new cutoff rows imported.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
