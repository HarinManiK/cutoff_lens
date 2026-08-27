import { listLocalJeeAdvancedDatasets } from "@/lib/local-cutoffs";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Dataset } from "@/lib/types";

type SupabaseSourceRow = {
  year: number;
  round: number;
};

function normalize(datasets: Dataset[]) {
  const seen = new Set<string>();

  return datasets
    .filter((dataset) => {
      const key = `${dataset.year}-${dataset.round}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.year - b.year || a.round - b.round);
}

export async function listJeeAdvancedDatasets(): Promise<{
  datasets: Dataset[];
  source: "supabase" | "local-csv";
}> {
  const supabase = createServerSupabaseClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("counselling_sources")
      .select("year, round, exams!inner(slug)")
      .eq("exams.slug", "jee-advanced")
      .gt("row_count", 0);

    if (error) throw new Error(error.message);

    return {
      datasets: normalize((data as SupabaseSourceRow[]).map(({ year, round }) => ({ year, round }))),
      source: "supabase",
    };
  }

  return {
    datasets: normalize(await listLocalJeeAdvancedDatasets()),
    source: "local-csv",
  };
}
