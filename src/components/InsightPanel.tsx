"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { formatRank, programShortName, shortenInstituteName } from "@/lib/display";
import { cohortLabel, disclosureLabel, type InstituteProfile } from "@/lib/content/institutes";
import { type Fact, type Provenance, provenanceLabel } from "@/lib/content/provenance";
import type { PairInsights } from "@/lib/insights";
import type { GenderFilter } from "@/lib/types";

export type InsightTarget = {
  institute: string;
  program: string;
  seatType: string;
  gender: GenderFilter;
  year: string;
  round: string;
};

type InsightResponse = {
  insights: PairInsights;
  institute: InstituteProfile | null;
  meta: { source: "supabase" | "local-csv" };
};

function Tag({ provenance }: { provenance: Provenance }) {
  return <span className={`prov prov--${provenance}`}>{provenanceLabel[provenance]}</span>;
}

function FactRow<T>({ label, fact }: { label: string; fact?: Fact<T> }) {
  if (!fact) return null;

  return (
    <div className="insight-fact">
      <div className="insight-fact__head">
        <span>{label}</span>
        <Tag provenance={fact.provenance} />
      </div>
      <p>
        {fact.provenance === "not-published"
          ? fact.note
          : String(fact.value)}
      </p>
      <div className="insight-fact__meta">
        {fact.asOf ? <span>{fact.asOf}</span> : null}
        {fact.publisher ? <span>{fact.publisher}</span> : null}
        {fact.source ? (
          <a href={fact.source} rel="noreferrer" target="_blank">
            Source <ExternalLink size={12} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function InsightPanel({ target, onClose }: { target: InsightTarget; onClose: () => void }) {
  const [data, setData] = useState<InsightResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      institute: target.institute,
      program: target.program,
      seatType: target.seatType,
      gender: target.gender,
      year: target.year,
      round: target.round,
    });

    setData(null);
    setError(null);

    fetch(`/api/cutoffs/jee-advanced/insights?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Unable to load insights.");
        }
        return response.json() as Promise<InsightResponse>;
      })
      .then(setData)
      .catch((nextError: Error) => {
        if (nextError.name !== "AbortError") setError(nextError.message);
      });

    return () => controller.abort();
  }, [target]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const insights = data?.insights;
  const profile = data?.institute;

  return (
    <>
      <div className="insight-scrim" onClick={onClose} />
      <aside className="insight-panel" aria-label="Branch insights">
        <header className="insight-panel__head">
          <div>
            <b>{shortenInstituteName(target.institute)}</b>
            <span>{programShortName(target.program)}</span>
          </div>
          <button type="button" aria-label="Close insights" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="insight-panel__body">
          {error ? <div className="empty-state">{error}</div> : null}

          {!data && !error ? (
            <div className="empty-state">
              <Loader2 className="inline animate-spin" size={16} /> Loading
            </div>
          ) : null}

          {insights ? (
            <section className="insight-section">
              <h4>From cutoff data</h4>

              <ul className="insight-points">
                {insights.rankWithinInstitute ? (
                  <li>
                    <b>
                      {insights.rankWithinInstitute.position} of {insights.rankWithinInstitute.outOf}
                    </b>{" "}
                    most competitive branches at this IIT, for {insights.seatType} in {insights.year}{" "}
                    Round {insights.round}
                  </li>
                ) : null}

                {insights.rankAcrossInstitutes ? (
                  <li>
                    {insights.institutesOfferingBranch === 1 ? (
                      <>The only IIT offering this branch</>
                    ) : (
                      <>
                        <b>
                          {insights.rankAcrossInstitutes.position} of{" "}
                          {insights.rankAcrossInstitutes.outOf}
                        </b>{" "}
                        IITs offering it, ranked by closing rank
                      </>
                    )}
                  </li>
                ) : null}

                {insights.roundMovement ? (
                  <li>
                    Within {insights.year}, closing rank moved from{" "}
                    <b>{formatRank(insights.roundMovement.from)}</b> in Round{" "}
                    {insights.roundMovement.firstRound} to{" "}
                    <b>{formatRank(insights.roundMovement.to)}</b> in Round{" "}
                    {insights.roundMovement.lastRound}
                  </li>
                ) : null}
              </ul>

              {insights.closingByYear.length > 0 ? (
                <div className="insight-grid">
                  <span className="insight-grid__title">Closing rank, last round of each year</span>
                  {insights.closingByYear.map((entry) => (
                    <div className="insight-cell" key={entry.year}>
                      <span>
                        {entry.year} R{entry.round}
                      </span>
                      <b>{formatRank(entry.closingRank)}</b>
                    </div>
                  ))}
                </div>
              ) : null}

              {insights.closingByCategory.length > 0 ? (
                <div className="insight-grid">
                  <span className="insight-grid__title">
                    Every seat type, {insights.year} Round {insights.round}
                  </span>
                  {insights.closingByCategory.map((entry) => (
                    <div
                      className={
                        entry.seatType === insights.seatType
                          ? "insight-cell is-current"
                          : "insight-cell"
                      }
                      key={entry.seatType}
                    >
                      <span>{entry.seatType}</span>
                      <b>{formatRank(entry.closingRank)}</b>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {profile ? (
            <section className="insight-section">
              <h4>About {shortenInstituteName(profile.name)}</h4>

              <div className="insight-fact">
                <div className="insight-fact__head">
                  <span>Location</span>
                </div>
                <p>
                  {profile.city}, {profile.state} &middot; {cohortLabel[profile.cohort]}
                </p>
              </div>

              <div className="insight-fact">
                <div className="insight-fact__head">
                  <span>Placement transparency</span>
                  <span className={`prov prov--disclosure-${profile.placementDisclosure}`}>
                    {disclosureLabel[profile.placementDisclosure]}
                  </span>
                </div>
              </div>

              <FactRow fact={profile.placementHeadline} label="Placement" />
              <FactRow fact={profile.branchPlacement} label="Branch-wise placement" />
              <FactRow fact={profile.researchFunding} label="Sponsored research" />
              <FactRow fact={profile.annualReport} label="Annual report" />
              <FactRow fact={profile.placementPage} label="Placement office" />
            </section>
          ) : null}

          <p className="insight-footnote">
            Cutoff figures are computed from official JoSAA data held by this site. Everything else
            is shown with its source, and gaps are listed rather than hidden.
          </p>
        </div>
      </aside>
    </>
  );
}
