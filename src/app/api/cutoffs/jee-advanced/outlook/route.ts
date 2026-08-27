import { NextRequest, NextResponse } from "next/server";
import { compareCutoffByInstituteAndProgram, toJosaaGender } from "@/lib/display";
import { listJeeAdvancedDatasets } from "@/lib/datasets";
import { loadLocalJeeAdvancedCutoffs } from "@/lib/local-cutoffs";
import { buildOutlook, finalRoundByYear } from "@/lib/outlook";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/supabase-rows";
import type { CutoffResult, GenderFilter } from "@/lib/types";

export const dynamic = "force-dynamic";

type SupabaseCutoffRow = {
  id: string;
  year: number;
  round: number;
  institute: string;
  program: string;
  quota: string;
  seat_type: string;
  gender: string;
  opening_rank_raw: string;
  closing_rank_raw: string;
  opening_rank_number: number;
  closing_rank_number: number;
  is_preparatory: boolean;
};

function parseRank(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseGender(value: string | null): GenderFilter {
  return value === "Female" ? "Female" : "Male";
}

function toResult(row: SupabaseCutoffRow): CutoffResult {
  return {
    id: row.id,
    year: row.year,
    round: row.round,
    institute: row.institute,
    program: row.program,
    quota: row.quota,
    seatType: row.seat_type,
    gender: row.gender,
    openingRankRaw: row.opening_rank_raw,
    closingRankRaw: row.closing_rank_raw,
    openingRankNumber: row.opening_rank_number,
    closingRankNumber: row.closing_rank_number,
    isPreparatory: row.is_preparatory,
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rank = parseRank(searchParams.get("rank"));
  const seatType = searchParams.get("seatType") ?? "OPEN";
  const gender = parseGender(searchParams.get("gender"));
  const josaaGender = toJosaaGender(gender);

  if (!rank) {
    return NextResponse.json({ error: "A rank is required to judge chances." }, { status: 400 });
  }

  // Only final-round rows are ever used, and PostgREST caps responses at 1000 rows, so
  // ask for exactly those rather than pulling every round and filtering afterwards.
  const { datasets, source } = await listJeeAdvancedDatasets();
  const finalRound = finalRoundByYear(datasets);
  const supabase = createServerSupabaseClient();
  let rows: CutoffResult[];

  if (supabase) {
    const yearRoundFilter = [...finalRound]
      .map(([year, round]) => `and(year.eq.${year},round.eq.${round})`)
      .join(",");

    const buildQuery = () =>
      supabase
        .from("cutoff_results")
        .select(
          "id, year, round, institute, program, quota, seat_type, gender, opening_rank_raw, closing_rank_raw, opening_rank_number, closing_rank_number, is_preparatory",
        )
        .eq("exam_slug", "jee-advanced")
        .eq("seat_type", seatType)
        .eq("gender", josaaGender)
        .eq("is_preparatory", false)
        .or(yearRoundFilter)
        .order("institute", { ascending: true })
        .order("program", { ascending: true });

    let data: SupabaseCutoffRow[];

    try {
      data = await fetchAllRows<SupabaseCutoffRow>(buildQuery);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to load cutoffs." },
        { status: 500 },
      );
    }

    rows = data.map(toResult);
  } else {
    const localRows = await loadLocalJeeAdvancedCutoffs();
    rows = localRows
      .filter((row) => row.seatType === seatType)
      .filter((row) => row.gender === josaaGender)
      .filter((row) => !row.isPreparatory)
      .filter((row) => finalRound.get(row.year) === row.round);
  }

  const outlook = buildOutlook(rows, rank).sort((a, b) =>
    compareCutoffByInstituteAndProgram(
      { institute: a.institute, program: a.program, closingRankNumber: a.loosestClosing },
      { institute: b.institute, program: b.program, closingRankNumber: b.loosestClosing },
    ),
  );

  const years = [...finalRound.keys()].sort((a, b) => a - b);

  return NextResponse.json({
    rows: outlook,
    meta: {
      source,
      rank,
      seatType,
      gender,
      years,
      total: outlook.length,
      safe: outlook.filter((row) => row.verdict === "safe").length,
      likely: outlook.filter((row) => row.verdict === "likely").length,
      reach: outlook.filter((row) => row.verdict === "reach").length,
    },
  });
}
