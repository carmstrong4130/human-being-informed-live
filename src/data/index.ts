/**
 * Build-time data registry. Every state's JSON snapshot is imported here so the
 * site ships fully static — no runtime fetch, no loading states. Freshness comes
 * from the scheduled fetcher committing new JSON, which rebuilds the site.
 */

import type { Bill, Committee, Legislator, StateMeta, VoteEvent } from "@/lib/types";

import utahBills from "./utah/bills.json";
import utahCommittees from "./utah/committees.json";
import utahLegislators from "./utah/legislators.json";
import utahMeta from "./utah/meta.json";
import utahVoteEvents from "./utah/vote-events.json";

export interface StateData {
  meta: StateMeta;
  legislators: Legislator[];
  committees: Committee[];
  bills: Bill[];
  voteEvents: VoteEvent[];
}

export const STATE_DATA: Record<string, StateData> = {
  utah: {
    meta: utahMeta as unknown as StateMeta,
    legislators: utahLegislators as unknown as Legislator[],
    committees: utahCommittees as unknown as Committee[],
    bills: utahBills as unknown as Bill[],
    voteEvents: utahVoteEvents as unknown as VoteEvent[],
  },
};

export function stateData(slug: string): StateData | null {
  return STATE_DATA[slug] ?? null;
}
