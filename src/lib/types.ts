/**
 * Shared types for the JSON data files under `src/data/<state>/`.
 *
 * These are the contract between `scripts/fetch-utah.ts` (writer) and the
 * React pages (readers). Keep them deliberately generic: today the only
 * governing bodies are state chambers and their committees, but the shape is
 * meant to grow into county / city councils without renaming anything.
 */

export type Chamber = "house" | "senate";

/** Raw party code as published by the state (Utah currently emits R, D and F). */
export type PartyCode = string;

export interface Legislator {
  /** State-assigned legislator id, e.g. "PETERT". Stable; used as the join key. */
  id: string;
  /** Display name, e.g. "Thomas W. Peterson". */
  name: string;
  chamber: Chamber;
  /** "R" | "D" | "F" | … — never assume two parties. */
  party: PartyCode;
  district: string;
  /** Official biography page on the chamber's own site. */
  bioUrl: string;
  /** Locally hosted portrait, e.g. "/legislators/PETERT.jpg". Null if none was available. */
  imageUrl: string | null;
}

export interface Committee {
  /** State-assigned committee id, e.g. "HSTNAE". */
  id: string;
  name: string;
  /** Absent for joint / interim committees that are not tied to one chamber. */
  chamber: Chamber | null;
  /** Legislator ids, in the order the state publishes them. */
  members: string[];
  officialUrl: string;
}

export interface Bill {
  /** Zero-padded number as the state uses it internally, e.g. "HB0060". */
  number: string;
  /** Display form, e.g. "H.B. 60". */
  numberShort: string;
  title: string;
  /** Session id, e.g. "2026GS". */
  session: string;
  /** Official static bill page. */
  url: string;
  sponsorName: string | null;
  lastAction: string | null;
  lastActionDate: string | null;
  /** State's own change token — used to skip re-fetching unchanged bills. */
  trackingID: string | null;
  updatetime: string | null;
}

/** Who does the voting at an event: a whole chamber, or one committee. */
export interface VoteBody {
  type: "chamber" | "committee";
  id: string;
  name: string;
  officialUrl: string;
}

export interface VoteEvent {
  kind: "floor" | "committee";
  billNumber: string;
  billTitle: string;
  billUrl: string;
  session: string;
  /** ISO datetime, or null when the state only publishes a calendar order. */
  when: string | null;
  /** "House 3rd Reading Calendar" | "110 Senate Building" … */
  whereLabel: string;
  body: VoteBody;
  /** Legislator ids eligible to vote at this event. */
  voterIds: string[];
  /** The official calendar / agenda page this event was derived from. */
  sourceUrl: string;
}

export interface SessionInfo {
  /** Session the data came from, e.g. "2026GS". Null if none could be resolved. */
  id: string | null;
  /** Human label for that session, e.g. "2026 General Session". */
  label: string;
  /** ISO date this session convened. */
  convenes: string | null;
  /** True while floor calendars / agendas can produce upcoming vote events. */
  inSession: boolean;
  /** The next general session, used for the out-of-session placeholder. */
  next: { id: string; label: string; convenes: string } | null;
}

export interface StateMeta {
  /** ISO timestamp of the last successful fetch. */
  lastUpdated: string;
  /** Which fetcher mode last wrote each slice. */
  lastUpdatedRoster?: string;
  lastUpdatedCalendars?: string;
  session: SessionInfo;
  counts: {
    legislators: number;
    committees: number;
    bills: number;
    voteEvents: number;
  };
  source: {
    name: string;
    url: string;
  };
}
