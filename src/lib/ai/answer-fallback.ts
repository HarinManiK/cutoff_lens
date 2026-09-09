import { formatRank } from "@/lib/display";
import type { GroundedContext, IncludedRow } from "@/lib/ai/jee-advanced-context";

// Deterministic answer built straight from the evidence. It runs with no model
// key configured and whenever the model is unreachable, so it has to stand on
// its own — and it must obey the same filters the model was given, or the
// student silently gets a different, worse answer than the one they asked for.

function poolLabel(ctx: GroundedContext) {
  return ctx.gender === "Female" ? "Female-only" : "Gender-Neutral";
}

function optionLine(row: IncludedRow, index: number, rank: number | null) {
  const margin = rank ? `, closes ${formatRank(row.margin)} above you` : "";
  return `${index + 1}. ${row.institute} — ${row.branch} (closing ${formatRank(row.closingRank)}${margin})`;
}

function scopeSuffix(ctx: GroundedContext) {
  return ctx.filterSummary ? ` matching ${ctx.filterSummary}` : "";
}

export function buildDatabaseAnswer(ctx: GroundedContext) {
  if (ctx.intent === "greeting") {
    return "Hi — I work off official JoSAA cutoffs for the IITs. Tell me your rank, category and whether you are applying in the Female-only or Gender-Neutral pool, and I will show what was in reach.";
  }

  if (ctx.intent === "identity") {
    return [
      "I am Cutoff Lens AI. I read official JoSAA opening and closing ranks for the IITs out of this site's database and show what was within reach for a given rank, category, gender, year and round.",
      "I do not predict future cutoffs — past closing ranks are a better guess, not a prediction.",
    ].join("\n\n");
  }

  if (ctx.intent === "out_of_scope") {
    return "That is outside what I can help with. I only cover JEE Advanced counselling for the IITs — cutoffs by rank and category, plus official sources on placements, fees and academic rules.";
  }

  if (ctx.needsRank) {
    return [
      `What rank are you working with? For ${ctx.seatType} I need your ${ctx.seatType === "OPEN" ? "CRL rank" : "category rank"}.`,
      `I have ${ctx.year} Round ${ctx.round} loaded. Send the rank plus anything I should correct, for example "SC 2807, female".`,
    ].join("\n\n");
  }

  if (ctx.needsGender) {
    return [
      `Got rank ${formatRank(ctx.rank ?? 0)} (${ctx.seatType}). One thing before I list anything: are you applying in the Female-only pool or Gender-Neutral?`,
      "Closing ranks differ completely between the two, so I do not want to show you the wrong seats.",
    ].join("\n\n");
  }

  if (ctx.intent === "process" || (ctx.intent === "college_info" && ctx.rank === null)) {
    if (ctx.facts.length === 0) {
      return "I do not have a verified source for that in my database. The official JoSAA site covers the counselling process, and each IIT publishes placements, fees and academic rules on its own placement-cell and academic-office pages.";
    }
    return [
      "Here is what I have verified sources for:",
      "",
      ...ctx.facts.map((fact) => `- [${fact.ref}] ${fact.institute} — ${fact.claim} (${fact.source_title || fact.publisher}${fact.published_ay ? `, ${fact.published_ay}` : ""})`),
      "",
      "Anything beyond these lines is not something I can confirm from official sources.",
    ].join("\n");
  }

  const header = `Official JoSAA ${ctx.year} Round ${ctx.round}, rank ${formatRank(ctx.rank ?? 0)}, ${ctx.seatType}, ${poolLabel(ctx)} seats.`;

  if (ctx.preferenceEmpty) {
    return [
      header,
      "",
      `Nothing${scopeSuffix(ctx)} appears in this round for that category and pool. Try relaxing one filter — a different branch group, or a different year/round.`,
    ].join("\n");
  }

  if (ctx.includedRows.length === 0) {
    const nearest = ctx.nearestAbove.slice(0, 5);
    const gap = nearest[0]?.shortfall ?? 0;
    // A 31,000-rank gap is not a "near miss". Saying so would be the kind of
    // soft framing this product exists to avoid.
    const farOut = ctx.rank !== null && gap > ctx.rank * 0.15;
    return [
      header,
      "",
      farOut && nearest[0]
        ? `Nothing${scopeSuffix(ctx)} was in reach. The highest closing rank in this round for ${ctx.seatType} / ${poolLabel(ctx)} was ${formatRank(nearest[0].closingRank)} (${nearest[0].institute} — ${nearest[0].branch}), which is ${formatRank(gap)} ranks ahead of you.`
        : `No program${scopeSuffix(ctx)} closed at or above your rank in this round.`,
      ...(nearest.length > 0 && !farOut
        ? [
            "",
            "Closest misses, so you know where you stand:",
            ...nearest.map((row, i) => `${i + 1}. ${row.institute} — ${row.branch} (closed ${formatRank(row.closingRank)}, short by ${formatRank(row.shortfall)})`),
          ]
        : []),
      "",
      farOut
        ? "Later rounds relax cutoffs a little, not by this much. Worth looking at NITs, IIITs and GFTIs through JoSAA, which this tool does not cover yet."
        : "A later round often relaxes cutoffs. Check another round or year, and only change category or gender if it matches your actual rank type.",
    ].join("\n");
  }

  // Ordered by closing rank ascending, so "tight" really is the competitive
  // end and "safe" really is the wide-margin end.
  const tight = ctx.includedRows.filter((row) => row.band === "tight").slice(0, 6);
  const safe = [...ctx.includedRows].sort((a, b) => b.margin - a.margin).slice(0, 5);
  const competitive = ctx.includedRows.slice(0, 6);

  const sections: string[] = [header, ""];

  if (tight.length > 0) {
    sections.push(
      `Most competitive${scopeSuffix(ctx)} — these close just above you, so they are the first to slip if cutoffs tighten:`,
      ...tight.map((row, i) => optionLine(row, i, ctx.rank)),
      "",
    );
  } else {
    sections.push(
      `Most competitive${scopeSuffix(ctx)} within reach:`,
      ...competitive.map((row, i) => optionLine(row, i, ctx.rank)),
      "",
    );
  }

  sections.push(
    "Widest margin — the safest of what is in reach:",
    ...safe.map((row, i) => optionLine(row, i, ctx.rank)),
  );

  if (ctx.stretchRows.length > 0) {
    sections.push(
      "",
      "Just missed — closed below your rank here, reachable only if cutoffs relax:",
      ...ctx.stretchRows
        .slice(0, 3)
        .map((row, i) => `${i + 1}. ${row.institute} — ${row.branch} (closed ${formatRank(row.closingRank)}, short by ${formatRank(row.shortfall)})`),
    );
  }

  const more = ctx.coverage.totalInReach - ctx.coverage.included;
  sections.push(
    "",
    `${formatRank(ctx.coverage.totalInReach)} programs${scopeSuffix(ctx)} were within reach in this round${
      more > 0 ? `; I am showing a spread across ${ctx.coverage.institutesIncluded} institutes` : ""
    }. Ask for a branch or an institute to narrow it.`,
    "",
    "These are official closing ranks for the round shown, not a prediction — cutoffs move year to year.",
  );

  return sections.join("\n");
}
