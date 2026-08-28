/**
 * Every fact shown about an institute or branch carries where it came from.
 *
 * This is the point of the feature. Search results for IIT placement data are dominated by
 * aggregators, and their numbers are indistinguishable from official ones once copied into
 * a card. Making provenance part of the type means a fact cannot be added without saying
 * what backs it.
 */
export type Provenance =
  /** Published by the institute itself. Carries a link and the date it refers to. */
  | "official"
  /** Computed from the JoSAA cutoff rows this site already holds. */
  | "derived"
  /** A named third party. Shown, but visibly marked as not from the institute. */
  | "unofficial"
  /** Checked for and absent. Displayed as a gap rather than quietly omitted. */
  | "not-published";

export type Fact<T> = {
  value: T;
  provenance: Provenance;
  /** Link to the document or page the value came from. Required for "official". */
  source?: string;
  /** Which period the value describes, e.g. "2024-25". Facts without this go stale silently. */
  asOf?: string;
  /** Named publisher, for "unofficial". */
  publisher?: string;
  /** Why it is missing, for "not-published". */
  note?: string;
};

export const provenanceLabel: Record<Provenance, string> = {
  official: "Official",
  derived: "From cutoff data",
  unofficial: "Third party",
  "not-published": "Not published",
};

export function official<T>(value: T, source: string, asOf?: string): Fact<T> {
  return { value, provenance: "official", source, asOf };
}

export function unofficial<T>(value: T, publisher: string, source?: string, asOf?: string): Fact<T> {
  return { value, provenance: "unofficial", publisher, source, asOf };
}

export function notPublished(note: string): Fact<null> {
  return { value: null, provenance: "not-published", note };
}
