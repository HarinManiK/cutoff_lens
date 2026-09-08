import { formatRank } from "@/lib/display";
import type { GroundedContext } from "@/lib/ai/jee-advanced-context";

// Deterministic database-only answer. Works with no LLM key and is the
// fallback whenever the model is unreachable. Never invents numbers.
export function buildDatabaseAnswer(ctx: GroundedContext) {
  if (!ctx.rank) {
    return [
      "What is your JEE Advanced rank?",
      `I have category ${ctx.seatType} and gender ${ctx.gender}, year ${ctx.year} round ${ctx.round} from your filters. Send rank plus any correction (e.g. "SC 2807, female, 2024 R5").`,
    ].join("\n\n");
  }
  if (ctx.totalMatchingRows === 0) {
    return [
      `Based on official JoSAA ${ctx.year} Round ${ctx.round} IIT data, I see no matching options for rank ${formatRank(ctx.rank)} with ${ctx.seatType} / ${ctx.gender}.`,
      "Try a different year/round, or remove branch/institution filters. Only change category/gender if it matches your actual rank type.",
    ].join("\n\n");
  }
  const lines = ctx.includedRows.slice(0, 8).map((r, i) => {
    const margin = `, margin +${formatRank(r.closingRank - (ctx.rank ?? 0))}`;
    return `${i + 1}. ${r.institute} - ${r.branch} (closing ${formatRank(r.closingRank)}${margin})`;
  });
  const safer = [...ctx.includedRows].sort((a, b) => b.closingRank - a.closingRank).slice(0, 5);
  const saferLines = safer.map((r, i) => `${i + 1}. ${r.institute} - ${r.branch} (closing ${formatRank(r.closingRank)})`);
  const factLines =
    ctx.facts.length > 0
      ? ctx.facts.slice(0, 4).map((f) => `- [${f.ref}] ${f.institute} ${f.topic}: ${f.claim} (${f.source_title || f.publisher}${f.published_ay ? `, ${f.published_ay}` : ""}, ${f.coverage}) ${f.source_url}`)
      : ["- No college facts retrieved for this question. Ask about placements, fees, rules or support for a specific IIT."];
  return [
    `Based on official JoSAA ${ctx.year} Round ${ctx.round} data for rank ${formatRank(ctx.rank)} (${ctx.seatType}, ${ctx.gender}):`,
    "",
    "Strongest options from your current filters:",
    ...lines,
    ...(ctx.truncated ? ["", `Showing ${ctx.includedRows.length} of ${ctx.totalMatchingRows}. Narrow filters for a tighter list.`] : []),
    "",
    "Safer picks by closing-rank margin:",
    ...saferLines,
    "",
    "Sources:",
    ...factLines,
  ].join("\n");
}
