import { NextResponse } from "next/server";
import { listLocalJeeAdvancedDatasets } from "@/lib/local-cutoffs";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Dataset } from "@/lib/types";

export const dynamic = "force-dynamic";

type SupabaseSourceRow = {
  year: number;
  round: number;
};

function sortDatasets(datasets: Dataset[]) {
  return datasets.sort((a, b) => a.year - b.year || a.round - b.round);
}

function uniqueDatasets(datasets: Dataset[]) {
  const seen = new Set<string>();

  return datasets.filter((dataset) => {
    const key = `${dataset.year}-${dataset.round}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET() {
  const supabase = createServerSupabaseClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("counselling_sources")
      .select("year, round, exams!inner(slug)")
      .eq("exams.slug", "jee-advanced")
      .gt("row_count", 0);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const datasets = sortDatasets(
      uniqueDatasets((data as SupabaseSourceRow[]).map(({ year, round }) => ({ year, round }))),
    );

    return NextResponse.json({ datasets, meta: { source: "supabase" } });
  }

  const datasets = sortDatasets(uniqueDatasets(await listLocalJeeAdvancedDatasets()));

  return NextResponse.json({ datasets, meta: { source: "local-csv" } });
}
