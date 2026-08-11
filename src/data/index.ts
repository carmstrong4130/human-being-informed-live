/**
 * Build-time data registry. Every state's JSON snapshot lives at
 * `src/data/<slug>/` and is discovered here at build time — no runtime fetch
 * against a third-party API. Freshness comes from the scheduled fetchers
 * committing new JSON, which rebuilds the site.
 *
 * The five files are pulled in with a *non-eager* `import.meta.glob`, so Vite
 * emits one chunk per state instead of inlining all 51 snapshots into whichever
 * bundle happens to reference this module. Only the state being viewed is ever
 * downloaded or parsed.
 */

import type { Bill, Committee, Legislator, StateMeta, VoteEvent } from "@/lib/types";

export interface StateData {
  meta: StateMeta;
  legislators: Legislator[];
  committees: Committee[];
  bills: Bill[];
  voteEvents: VoteEvent[];
}

type JsonModule = () => Promise<{ default: unknown }>;

// Keys are relative and literal, e.g. "./utah/meta.json".
const META = import.meta.glob("./*/meta.json") as Record<string, JsonModule>;
const LEGISLATORS = import.meta.glob("./*/legislators.json") as Record<string, JsonModule>;
const COMMITTEES = import.meta.glob("./*/committees.json") as Record<string, JsonModule>;
const BILLS = import.meta.glob("./*/bills.json") as Record<string, JsonModule>;
const VOTE_EVENTS = import.meta.glob("./*/vote-events.json") as Record<string, JsonModule>;

/** Slugs that actually have a data folder committed, derived from the glob. */
export const DATA_SLUGS: string[] = Object.keys(META)
  .map((key) => key.split("/")[1] ?? "")
  .filter(Boolean)
  .sort();

export function hasStateData(slug: string): boolean {
  return `./${slug}/meta.json` in META;
}

async function load<T>(
  files: Record<string, JsonModule>,
  slug: string,
  file: string,
): Promise<T | null> {
  const importer = files[`./${slug}/${file}`];
  if (!importer) return null;
  return (await importer()).default as T;
}

/**
 * Loads one state's snapshot. Returns null when the slug has no data folder, so
 * callers can fall through to the not-found page.
 */
export async function stateData(slug: string): Promise<StateData | null> {
  if (!hasStateData(slug)) return null;

  const [meta, legislators, committees, bills, voteEvents] = await Promise.all([
    load<StateMeta>(META, slug, "meta.json"),
    load<Legislator[]>(LEGISLATORS, slug, "legislators.json"),
    load<Committee[]>(COMMITTEES, slug, "committees.json"),
    load<Bill[]>(BILLS, slug, "bills.json"),
    load<VoteEvent[]>(VOTE_EVENTS, slug, "vote-events.json"),
  ]);

  // meta.json is the one file a state cannot render without.
  if (!meta) return null;

  return {
    meta,
    legislators: legislators ?? [],
    committees: committees ?? [],
    bills: bills ?? [],
    voteEvents: voteEvents ?? [],
  };
}
