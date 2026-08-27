"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatRank, programShortName, shortenInstituteName } from "@/lib/display";
import { cutoffMatchesSearch } from "@/lib/search";
import type { OutlookRow, Verdict } from "@/lib/outlook";
import type { GenderFilter } from "@/lib/types";

type OutlookResponse = {
  rows: OutlookRow[];
  meta: {
    source: "supabase" | "local-csv";
    rank: number;
    years: number[];
    total: number;
    safe: number;
    likely: number;
    reach: number;
  };
};

const verdictLabel: Record<Verdict, string> = {
  safe: "Safe",
  likely: "Likely",
  reach: "Reach",
};

const verdictBlurb: Record<Verdict, string> = {
  safe: "Cleared in every year on record.",
  likely: "Cleared in some years but not others. Genuinely uncertain.",
  reach: "Cleared in no year on record, but close enough to be worth listing.",
};

function trackRecord(row: OutlookRow) {
  if (row.singleYearOnly) {
    const only = row.closings[0];
    return `${only.year} only — ${only.cleared ? "cleared" : "missed"}. One year is thin evidence.`;
  }

  if (row.verdict === "likely") {
    const cleared = row.closings.filter((closing) => closing.cleared).map((closing) => closing.year);
    const missed = row.closings.filter((closing) => !closing.cleared).map((closing) => closing.year);
    return `Cleared in ${cleared.join(", ")}, missed in ${missed.join(", ")}.`;
  }

  return `${row.yearsCleared} of ${row.yearsObserved} years.`;
}

export function ChancesPanel({
  rank,
  seatType,
  gender,
  search,
}: {
  rank: number | null;
  seatType: string;
  gender: GenderFilter;
  search: string;
}) {
  const [data, setData] = useState<OutlookResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rank) {
      setData(null);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ rank: String(rank), seatType, gender });

    setLoading(true);
    setError(null);

    fetch(`/api/cutoffs/jee-advanced/outlook?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Unable to work out chances.");
        }
        return response.json() as Promise<OutlookResponse>;
      })
      .then(setData)
      .catch((nextError: Error) => {
        if (nextError.name !== "AbortError") {
          setError(nextError.message);
          setData(null);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [gender, rank, seatType]);

  if (!rank) {
    return <div className="empty-state">Enter your rank to see which branches were within reach.</div>;
  }

  if (loading) {
    return (
      <div className="empty-state">
        <Loader2 className="inline animate-spin" size={18} /> Working out chances
      </div>
    );
  }

  if (error) return <div className="empty-state">{error}</div>;
  if (!data) return null;

  const latestYear = data.meta.years[data.meta.years.length - 1];

  const visibleRows = data.rows.filter((row) =>
    cutoffMatchesSearch(
      {
        id: row.id,
        year: latestYear,
        round: row.closings[row.closings.length - 1].round,
        institute: row.institute,
        program: row.program,
        quota: "AI",
        seatType,
        gender,
        openingRankRaw: "",
        closingRankRaw: "",
        openingRankNumber: 0,
        closingRankNumber: row.loosestClosing,
        isPreparatory: false,
      },
      search,
    ),
  );

  const groups: Verdict[] = ["safe", "likely", "reach"];

  return (
    <div className="chances">
      <p className="chances__basis">
        Based on the final counselling round of {data.meta.years.join(" and ")}, for {seatType} and{" "}
        {gender === "Female" ? "Female-only" : "Gender-Neutral"} seats at rank {formatRank(data.meta.rank)}. These are
        past closing ranks, not a prediction. A rank that cleared last year can miss this year.
      </p>

      {groups.map((verdict) => {
        const rows = visibleRows.filter((row) => row.verdict === verdict);
        if (rows.length === 0) return null;

        return (
          <section className="chances__group" key={verdict}>
            <header className={`chances__head chances__head--${verdict}`}>
              <b>
                {verdictLabel[verdict]}
                <span>{rows.length}</span>
              </b>
              <span>{verdictBlurb[verdict]}</span>
            </header>

            <div className="table-wrap">
              <table className="results-table">
                <thead>
                  <tr>
                    <th className="col-institute">IIT</th>
                    <th className="col-program">Branch</th>
                    {data.meta.years.map((year) => (
                      <th className="col-closingRank" key={year}>
                        {year} close
                      </th>
                    ))}
                    <th className="col-degree">Track record</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="col-institute">{shortenInstituteName(row.institute)}</td>
                      <td className="col-program">{programShortName(row.program)}</td>
                      {data.meta.years.map((year) => {
                        const closing = row.closings.find((entry) => entry.year === year);

                        if (!closing) {
                          return (
                            <td className="col-closingRank muted" key={year}>
                              not offered
                            </td>
                          );
                        }

                        return (
                          <td className="col-closingRank" key={year}>
                            <span className={closing.cleared ? "rank-badge" : "rank-badge rank-badge--missed"}>
                              {formatRank(closing.closingRank)}
                            </span>
                          </td>
                        );
                      })}
                      <td className="col-degree">{trackRecord(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-results">
              {rows.map((row) => (
                <article className="result-card" key={row.id}>
                  <div className="result-card__head">
                    <div>
                      <h3>{shortenInstituteName(row.institute)}</h3>
                      <p>{programShortName(row.program)}</p>
                    </div>
                  </div>

                  <div className="card-fields">
                    {row.closings.map((closing) => (
                      <span className="card-field" key={closing.year}>
                        <span>{closing.year} close</span>
                        <b className={closing.cleared ? "" : "muted"}>{formatRank(closing.closingRank)}</b>
                      </span>
                    ))}
                    <span className="card-field">
                      <span>Track record</span>
                      <b>{trackRecord(row)}</b>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}

      {visibleRows.length === 0 ? <div className="empty-state">No matching branches</div> : null}
    </div>
  );
}
