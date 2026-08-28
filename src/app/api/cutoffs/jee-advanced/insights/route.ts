import { NextRequest, NextResponse } from "next/server";
import { toJosaaGender } from "@/lib/display";
import { instituteProfile } from "@/lib/content/institutes";
import { buildPairInsights } from "@/lib/insights";
import { loadLocalJeeAdvancedCutoffs } from "@/lib/local-cutoffs";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/supabase-rows";
import type { CutoffResult, GenderFilter } from "@/lib/types";

export const dynamic = "force-dynamic";

const SELECT =
  "id, year, round, institute, program, quota, seat_type, gender, opening_rank_raw, closing_rank_raw, opening_rank_number, closing_rank_number, is_preparatory";

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

function parsePositiveInt(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const institute = params.get("institute")?.trim();
  const program = params.get("program")?.trim();
  const seatType = params.get("seatType") ?? "OPEN";
  const gender: GenderFilter = params.get("gender") === "Female" ? "Female" : "Male";
  const josaaGender = toJosaaGender(gender);
  const year = parsePositiveInt(params.get("year"));
  const round = parsePositiveInt(params.get("round"));

  if (!institute || !program || !year || !round) {
    return NextResponse.json(
      { error: "institute, program, year and round are all required." },
      { status: 400 },
    );
  }

  const supabase = createServerSupabaseClient();
  let scope: CutoffResult[];
  let history: CutoffResult[];

  try {
    if (supabase) {
      // Everything in the selected slice, for the two rankings.
      scope = (
        await fetchAllRows<SupabaseCutoffRow>(() =>
          supabase
            .from("cutoff_results")
            .select(SELECT)
            .eq("exam_slug", "jee-advanced")
            .eq("year", year)
            .eq("round", round)
            .eq("seat_type", seatType)
            .eq("gender", josaaGender)
            .eq("is_preparatory", false)
            .order("institute", { ascending: true }),
        )
      ).map(toResult);

      // This one seat across every year, round and seat type, for the trends.
      history = (
        await fetchAllRows<SupabaseCutoffRow>(() =>
          supabase
            .from("cutoff_results")
            .select(SELECT)
            .eq("exam_slug", "jee-advanced")
            .eq("institute", institute)
            .eq("program", program)
            .eq("gender", josaaGender)
            .eq("is_preparatory", false)
            .order("year", { ascending: true }),
        )
      ).map(toResult);
    } else {
      const rows = await loadLocalJeeAdvancedCutoffs();
      scope = rows.filter(
        (row) =>
          row.year === year &&
          row.round === round &&
          row.seatType === seatType &&
          row.gender === josaaGender &&
          !row.isPreparatory,
      );
      history = rows.filter(
        (row) =>
          row.institute === institute &&
          row.program === program &&
          row.gender === josaaGender &&
          !row.isPreparatory,
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load insights." },
      { status: 500 },
    );
  }

  const insights = buildPairInsights({
    institute,
    program,
    seatType,
    gender: josaaGender,
    year,
    round,
    scope,
    history,
  });

  return NextResponse.json({
    insights,
    institute: instituteProfile(institute),
    meta: { source: supabase ? "supabase" : "local-csv" },
  });
}
