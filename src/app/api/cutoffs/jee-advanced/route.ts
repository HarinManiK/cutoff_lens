import { NextRequest, NextResponse } from "next/server";
import { compareCutoffByInstituteAndProgram, toJosaaGender } from "@/lib/display";
import { loadLocalJeeAdvancedCutoffs } from "@/lib/local-cutoffs";
import { createServerSupabaseClient } from "@/lib/supabase-server";
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

function parseNumberParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRank(value: string | null) {
  if (!value) return null;
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

function filterRows(
  rows: CutoffResult[],
  year: number,
  round: number,
  seatType: string,
  gender: string,
  rank: number | null,
) {
  return rows
    .filter((row) => row.year === year)
    .filter((row) => row.round === round)
    .filter((row) => row.seatType === seatType)
    .filter((row) => row.gender === gender)
    .filter((row) => !row.isPreparatory)
    .filter((row) => (rank ? row.closingRankNumber >= rank : true))
    .sort(compareCutoffByInstituteAndProgram);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const year = parseNumberParam(searchParams.get("year"), 2025);
  const round = parseNumberParam(searchParams.get("round"), 5);
  const seatType = searchParams.get("seatType") ?? "OPEN";
  const gender = parseGender(searchParams.get("gender"));
  const josaaGender = toJosaaGender(gender);
  const rank = parseRank(searchParams.get("rank"));
  const supabase = createServerSupabaseClient();

  if (supabase) {
    let query = supabase
      .from("cutoff_results")
      .select(
        "id, year, round, institute, program, quota, seat_type, gender, opening_rank_raw, closing_rank_raw, opening_rank_number, closing_rank_number, is_preparatory",
      )
      .eq("exam_slug", "jee-advanced")
      .eq("year", year)
      .eq("round", round)
      .eq("seat_type", seatType)
      .eq("gender", josaaGender)
      .eq("is_preparatory", false)
      .order("institute", { ascending: true })
      .order("program", { ascending: true })
      .limit(5000);

    if (rank) {
      query = query.gte("closing_rank_number", rank);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data as SupabaseCutoffRow[]).map(toResult).sort(compareCutoffByInstituteAndProgram);

    return NextResponse.json({
      rows,
      meta: {
        source: "supabase",
        year,
        round,
        seatType,
        gender,
        rank,
        total: rows.length,
      },
    });
  }

  const localRows = await loadLocalJeeAdvancedCutoffs();
  const rows = filterRows(localRows, year, round, seatType, josaaGender, rank);

  return NextResponse.json({
    rows,
    meta: {
      source: "local-csv",
      year,
      round,
      seatType,
      gender,
      rank,
      total: rows.length,
    },
  });
}
