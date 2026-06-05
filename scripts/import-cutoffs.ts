import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

type CliOptions = {
  csvPath: string;
  exam: string;
  examName: string;
  year: number;
  round: number;
  instituteType: string;
};

function parseArgs(argv: string[]): CliOptions {
  const [csvPath, ...flags] = argv;

  if (!csvPath) {
    throw new Error("CSV path is required.");
  }

  const options = new Map<string, string>();
  for (const flag of flags) {
    const [rawKey, ...rawValue] = flag.replace(/^--/, "").split("=");
    options.set(rawKey, rawValue.join("="));
  }

  const year = Number(options.get("year"));
  const round = Number(options.get("round"));

  if (!Number.isInteger(year) || !Number.isInteger(round)) {
    throw new Error("--year and --round must be integers.");
  }

  return {
    csvPath,
    exam: options.get("exam") ?? "jee-advanced",
    examName: options.get("exam-name") ?? "JEE Advanced",
    year,
    round,
    instituteType: options.get("institute-type") ?? "IIT",
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before importing.");
  }

  const absoluteCsvPath = path.resolve(options.csvPath);
  const fileBuffer = await readFile(absoluteCsvPath);
  const sourceSha256 = createHash("sha256").update(fileBuffer).digest("hex");

  const rows = parse(fileBuffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: exam, error: examError } = await supabase
    .from("exams")
    .upsert({ slug: options.exam, name: options.examName }, { onConflict: "slug" })
    .select("id")
    .single();

  if (examError || !exam) {
    throw new Error(`Unable to upsert exam: ${examError?.message}`);
  }

  const { data: existingSource, error: existingSourceError } = await supabase
    .from("counselling_sources")
    .select("id, row_count")
    .eq("source_sha256", sourceSha256)
    .maybeSingle();

  if (existingSourceError) {
    throw new Error(`Unable to inspect source: ${existingSourceError.message}`);
  }

  if (existingSource && existingSource.row_count > 0) {
    console.log(`Source already imported (${existingSource.row_count} rows).`);
    return;
  }

  const { data: source, error: sourceError } = await supabase
    .from("counselling_sources")
    .upsert(
      {
        exam_id: exam.id,
        year: options.year,
        round: options.round,
        institute_type: options.instituteType,
        source_file_name: path.basename(absoluteCsvPath),
        source_sha256: sourceSha256,
        row_count: 0,
      },
      { onConflict: "source_sha256" },
    )
    .select("id")
    .single();

  if (sourceError || !source) {
    throw new Error(`Unable to create source: ${sourceError?.message}`);
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
      exam_id: exam.id,
      institute_id: instituteId,
      program_id: programId,
      year: options.year,
      round: options.round,
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
      throw new Error(`Unable to insert rows ${start + 1}-${start + chunk.length}: ${error.message}`);
    }
  }

  const { error: updateSourceError } = await supabase
    .from("counselling_sources")
    .update({ row_count: rows.length })
    .eq("id", source.id);

  if (updateSourceError) {
    throw new Error(`Unable to update source row count: ${updateSourceError.message}`);
  }

  console.log(`Imported ${rows.length} cutoff rows from ${path.basename(absoluteCsvPath)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
