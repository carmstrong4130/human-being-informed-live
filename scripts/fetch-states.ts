/**
 * fetch-states.ts — the national data pipeline: all 50 states plus DC, minus
 * Utah, which keeps its own richer fetcher against le.utah.gov.
 *
 *   node scripts/fetch-states.ts --mode=roster                    # people + committees, no API calls
 *   node scripts/fetch-states.ts --mode=calendars                 # sessions + events + bills, budgeted
 *   node scripts/fetch-states.ts --mode=calendars --states=ca,ne,dc
 *
 * Two sources, chosen so the expensive one is used as little as possible:
 *
 *   Rosters    the `openstates/people` git repository, read as a tarball. Public
 *              domain, no key, no quota — one 5 MB download covers every state.
 *   Calendars  the OpenStates (Plural) v3 API, https://docs.openstates.org/api-v3/.
 *              Free tier is 10 requests/minute and 250/day, which is the binding
 *              constraint on this whole script: see REQUEST_BUDGET below.
 *
 * Env: `OPENSTATES_API_KEY` (required for calendars mode; free key from
 * https://open.pluralpolicy.com/accounts/profile/).
 *
 * Coverage caveat worth knowing when reading the output: OpenStates has event
 * scrapers for every state, but real-world coverage is thin in some and floor
 * reading calendars are largely absent, so nearly every VoteEvent produced here
 * is a committee hearing. LegiScan (30k queries/month, and a real `sine_die`
 * adjournment flag) is the obvious upgrade path for session-status accuracy, but
 * it publishes no photos, bio links, committee rosters or events feed, so it
 * cannot replace either source above.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import type {
  Bill,
  Chamber,
  Committee,
  Legislator,
  SessionInfo,
  StateMeta,
  VoteEvent,
} from "../src/lib/types.ts";
import { JURISDICTIONS, type Jurisdiction } from "./jurisdictions.ts";
import { readTar } from "./lib/tar.ts";
import { asList, asString, isYamlMap, parseYaml, type YamlMap } from "./lib/yaml.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_ROOT = path.join(ROOT, "src", "data");

const PEOPLE_TARBALL = "https://codeload.github.com/openstates/people/tar.gz/refs/heads/main";
const API_BASE = "https://v3.openstates.org";
const USER_AGENT = "humanbeinginformed.com data fetcher (contact: hello@humanbeinginformed.com)";

/**
 * The free tier allows 250 requests/day. Stopping at 230 leaves headroom for a
 * manual re-run or a retry after a failure, and the stop is reported loudly so a
 * partial run can never be mistaken for a complete one.
 */
const REQUEST_BUDGET = 230;

/** 10 requests/minute is the documented ceiling; 7s spacing keeps a margin. */
const REQUEST_DELAY_MS = 7_000;

/** Events are paged 20 at a time; this caps a single state's share of the budget. */
const MAX_EVENT_PAGES = 5;

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(...args: unknown[]) {
  console.log("[fetch-states]", ...args);
}

function warn(...args: unknown[]) {
  console.warn("[fetch-states] WARN", ...args);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Writes only when the serialized content actually differs, so commits stay meaningful. */
async function writeJsonIfChanged(file: string, value: unknown): Promise<boolean> {
  const next = JSON.stringify(value, null, 2) + "\n";
  let current: string | null = null;
  try {
    current = await fs.readFile(file, "utf8");
  } catch {
    /* file does not exist yet */
  }
  if (current === next) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next, "utf8");
  return true;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Picks the most official-looking URL from ordered candidate lists.
 *
 * The corpus mixes a legislator's own chamber page in with campaign sites,
 * Ballotpedia and Wikipedia, so preference order matters: the legislature's own
 * host first, then any government host, then whatever came first.
 */
function pickOfficialUrl(candidateLists: string[][], homepage: string): string {
  const officialHost = hostOf(homepage);
  const all = candidateLists.flat();

  if (officialHost) {
    const sameSite = all.find((url) => {
      const host = hostOf(url);
      return (
        host !== null &&
        (host === officialHost ||
          host.endsWith(`.${officialHost}`) ||
          officialHost.endsWith(`.${host}`))
      );
    });
    if (sameSite) return sameSite;
  }

  const government = all.find((url) => {
    const host = hostOf(url);
    return host !== null && (host.endsWith(".gov") || host.endsWith(".us"));
  });
  if (government) return government;

  return all[0] ?? homepage;
}

// ---------------------------------------------------------------------------
// Mapping OpenStates vocabulary onto ours
// ---------------------------------------------------------------------------

/** OpenStates names chambers "upper"/"lower", or "legislature" where there is one body. */
function chamberFromRoleType(type: string | null): Chamber | null {
  if (type === "upper") return "senate";
  if (type === "lower") return "house";
  if (type === "legislature") return "legislature";
  return null;
}

/** Joint and interim committees belong to no single chamber, which the type allows. */
function chamberFromCommittee(value: string | null): Chamber | null {
  return chamberFromRoleType(value);
}

const PARTY_CODES: Record<string, string> = {
  Republican: "R",
  Democratic: "D",
  Democrat: "D",
  Independent: "I",
  Nonpartisan: "N",
  Green: "G",
  Libertarian: "L",
  Progressive: "P",
  Conservative: "C",
  Unaffiliated: "U",
  Forward: "F",
  Independence: "IP",
  "Working Families": "W",
  "Democratic-Farmer-Labor": "DFL",
  "No Party Affiliation": "NPA",
};

/**
 * Shortens a party name to the code the UI prints.
 *
 * New York and a few others record fusion tickets as "Democratic/Working
 * Families"; the first line is the one that identifies the member, so the code
 * comes from that. Unrecognized names fall back to their initial, which
 * `PartyTag` renders neutrally.
 */
function partyCode(name: string): string {
  const exact = PARTY_CODES[name];
  if (exact) return exact;
  const primary = (name.split("/")[0] ?? "").trim();
  const mapped = PARTY_CODES[primary];
  if (mapped) return mapped;
  return (primary || name).slice(0, 1).toUpperCase();
}

// ---------------------------------------------------------------------------
// Mode: roster — openstates/people, zero API cost
// ---------------------------------------------------------------------------

interface StateYaml {
  people: YamlMap[];
  committees: YamlMap[];
}

const PEOPLE_PATH_RE = /^[^/]+\/data\/([a-z]{2})\/(legislature|committees)\/[^/]+\.ya?ml$/;

/** Downloads the people repo once and returns the parsed YAML grouped by postal code. */
async function loadPeopleRepo(wanted: Set<string>): Promise<Map<string, StateYaml>> {
  log("downloading openstates/people tarball…");
  const res = await fetch(PEOPLE_TARBALL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`people tarball: HTTP ${res.status}`);
  const gz = Buffer.from(await res.arrayBuffer());
  const raw = zlib.gunzipSync(gz, { maxOutputLength: 1 << 30 });
  log(
    `tarball ${(gz.length / 1048576).toFixed(1)} MB compressed, ${(raw.length / 1048576).toFixed(0)} MB expanded`,
  );

  const byState = new Map<string, StateYaml>();
  let parsed = 0;
  let failed = 0;

  for (const entry of readTar(raw)) {
    const match = PEOPLE_PATH_RE.exec(entry.path);
    if (!match) continue;
    const postal = match[1];
    const kind = match[2];
    if (!postal || !kind || !wanted.has(postal)) continue;

    let doc: YamlMap;
    try {
      const value = parseYaml(entry.data.toString("utf8"));
      if (!isYamlMap(value)) throw new Error("top level is not a mapping");
      doc = value;
    } catch (err) {
      // A record we cannot read in full is skipped rather than half-trusted.
      failed += 1;
      warn(`${entry.path}: ${String(err)}`);
      continue;
    }

    const bucket = byState.get(postal) ?? { people: [], committees: [] };
    if (kind === "legislature") bucket.people.push(doc);
    else bucket.committees.push(doc);
    byState.set(postal, bucket);
    parsed += 1;
  }

  log(
    `parsed ${parsed} YAML files across ${byState.size} jurisdictions${failed ? `, ${failed} skipped` : ""}`,
  );
  return byState;
}

/** The role that describes what this person is now, preferring one that has not ended. */
function currentRole(doc: YamlMap, today: string): YamlMap | null {
  const legislative = asList(doc["roles"])
    .filter(isYamlMap)
    .filter((role) => chamberFromRoleType(asString(role["type"])) !== null);
  if (legislative.length === 0) return null;

  const unexpired = legislative.filter((role) => {
    const end = asString(role["end_date"]);
    return end === null || end >= today;
  });
  const pool = unexpired.length > 0 ? unexpired : legislative;

  let best: YamlMap | null = null;
  for (const role of pool) {
    if (!best || (asString(role["start_date"]) ?? "") >= (asString(best["start_date"]) ?? "")) {
      best = role;
    }
  }
  return best;
}

function currentPartyName(doc: YamlMap, today: string): string | null {
  const entries = asList(doc["party"]);
  const names: string[] = [];
  for (const entry of entries) {
    if (isYamlMap(entry)) {
      const end = asString(entry["end_date"]);
      if (end !== null && end < today) continue;
      const name = asString(entry["name"]);
      if (name) names.push(name);
    } else if (typeof entry === "string" && entry.trim() !== "") {
      names.push(entry.trim());
    }
  }
  return names[names.length - 1] ?? null;
}

function buildLegislators(docs: YamlMap[], juris: Jurisdiction, today: string): Legislator[] {
  const out: Legislator[] = [];

  for (const doc of docs) {
    const id = asString(doc["id"]);
    const name = asString(doc["name"]);
    if (!id || !name) {
      warn(`${juris.code}: person with no id or name — skipped`);
      continue;
    }
    const role = currentRole(doc, today);
    const chamber = chamberFromRoleType(asString(role?.["type"]));
    if (!role || !chamber) {
      // Mayors and other executive roles live in the same tree; not our subject.
      continue;
    }

    const links = asList(doc["links"])
      .filter(isYamlMap)
      .map((l) => asString(l["url"]))
      .filter((u): u is string => u !== null);
    const sources = asList(doc["sources"])
      .filter(isYamlMap)
      .map((s) => asString(s["url"]))
      .filter((u): u is string => u !== null);

    const partyName = currentPartyName(doc, today);

    out.push({
      id,
      name,
      chamber,
      party: partyName ? partyCode(partyName) : "",
      district: asString(role["district"]) ?? "",
      bioUrl: pickOfficialUrl([links, sources], juris.url),
      // Hotlinked deliberately: mirroring 7,000+ portraits would bloat the repo,
      // and `Portrait` falls back to initials when a remote image fails.
      imageUrl: asString(doc["image"]),
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function buildCommittees(docs: YamlMap[], juris: Jurisdiction): Committee[] {
  const out: Committee[] = [];

  for (const doc of docs) {
    const id = asString(doc["id"]);
    const name = asString(doc["name"]);
    if (!id || !name) {
      warn(`${juris.code}: committee with no id or name — skipped`);
      continue;
    }

    const links = asList(doc["links"])
      .filter(isYamlMap)
      .map((l) => asString(l["url"]))
      .filter((u): u is string => u !== null);
    const sources = asList(doc["sources"])
      .filter(isYamlMap)
      .map((s) => asString(s["url"]))
      .filter((u): u is string => u !== null);

    const members = asList(doc["members"])
      .filter(isYamlMap)
      .map((m) => asString(m["person_id"]))
      .filter((v): v is string => v !== null);

    out.push({
      id,
      name,
      chamber: chamberFromCommittee(asString(doc["chamber"])),
      members,
      officialUrl: pickOfficialUrl([links, sources], juris.url),
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** The placeholder session used before calendars mode has ever run for a state. */
function unknownSession(): SessionInfo {
  return { id: null, label: "", convenes: null, inSession: false, next: null };
}

async function loadMeta(slug: string): Promise<StateMeta | null> {
  return readJsonFile<StateMeta>(path.join(DATA_ROOT, slug, "meta.json"));
}

/**
 * Writes meta.json, preserving whatever the other mode owns. Optional timestamps
 * are only ever assigned when present, because the app's tsconfig runs with
 * `exactOptionalPropertyTypes`.
 */
async function saveMeta(
  juris: Jurisdiction,
  existing: StateMeta | null,
  patch: {
    session?: SessionInfo;
    counts?: Partial<StateMeta["counts"]>;
    touchedRoster?: boolean;
    touchedCalendars?: boolean;
    changed: boolean;
  },
  now: Date,
): Promise<void> {
  const nowIso = now.toISOString();
  const counts = {
    legislators: patch.counts?.legislators ?? existing?.counts.legislators ?? 0,
    committees: patch.counts?.committees ?? existing?.counts.committees ?? 0,
    bills: patch.counts?.bills ?? existing?.counts.bills ?? 0,
    voteEvents: patch.counts?.voteEvents ?? existing?.counts.voteEvents ?? 0,
  };

  const meta: StateMeta = {
    lastUpdated: patch.changed ? nowIso : (existing?.lastUpdated ?? nowIso),
    session: patch.session ?? existing?.session ?? unknownSession(),
    counts,
    source: { name: juris.legislatureName, url: juris.url },
  };

  const roster = patch.touchedRoster && patch.changed ? nowIso : existing?.lastUpdatedRoster;
  if (roster) meta.lastUpdatedRoster = roster;
  const calendars =
    patch.touchedCalendars && patch.changed ? nowIso : existing?.lastUpdatedCalendars;
  if (calendars) meta.lastUpdatedCalendars = calendars;

  await writeJsonIfChanged(path.join(DATA_ROOT, juris.slug, "meta.json"), meta);
}

async function runRoster(targets: Jurisdiction[]): Promise<void> {
  const now = new Date();
  const today = isoDate(now);
  const byState = await loadPeopleRepo(new Set(targets.map((j) => j.postal)));

  let changedStates = 0;

  for (const juris of targets) {
    try {
      const yaml = byState.get(juris.postal);
      if (!yaml || yaml.people.length === 0) {
        warn(
          `${juris.code}: no legislator files in openstates/people — previous data left in place`,
        );
        continue;
      }

      const legislators = buildLegislators(yaml.people, juris, today);
      const committees = buildCommittees(yaml.committees, juris);
      if (legislators.length === 0) {
        warn(`${juris.code}: produced no legislators — previous data left in place`);
        continue;
      }

      const dir = path.join(DATA_ROOT, juris.slug);
      const changedLegislators = await writeJsonIfChanged(
        path.join(dir, "legislators.json"),
        legislators,
      );
      const changedCommittees = await writeJsonIfChanged(
        path.join(dir, "committees.json"),
        committees,
      );

      // Keep every state folder uniform without clobbering calendars output.
      for (const file of ["bills.json", "vote-events.json"]) {
        const full = path.join(dir, file);
        if ((await readJsonFile<unknown[]>(full)) === null) await writeJsonIfChanged(full, []);
      }

      const existing = await loadMeta(juris.slug);
      const changed = changedLegislators || changedCommittees;
      await saveMeta(
        juris,
        existing,
        {
          counts: { legislators: legislators.length, committees: committees.length },
          touchedRoster: true,
          changed,
        },
        now,
      );

      if (changed) changedStates += 1;
      log(
        `${juris.code} ${juris.slug}: ${legislators.length} legislators, ${committees.length} committees${changed ? " (updated)" : " (unchanged)"}`,
      );
    } catch (err) {
      warn(`${juris.code}: roster failed — ${String(err)} (previous data left in place)`);
    }
  }

  log(`roster done — ${changedStates} of ${targets.length} jurisdictions changed`);
}

// ---------------------------------------------------------------------------
// Mode: calendars — OpenStates v3, strictly budgeted
// ---------------------------------------------------------------------------

class ApiClient {
  private readonly key: string;
  private used = 0;
  private lastRequestAt = 0;

  constructor(key: string) {
    this.key = key;
  }

  get requestsUsed(): number {
    return this.used;
  }

  get requestsLeft(): number {
    return REQUEST_BUDGET - this.used;
  }

  /**
   * One budgeted GET. Returns null for a 404 (a bill or jurisdiction the API does
   * not have), and throws on anything else so the caller's per-state catch can
   * preserve that state's existing data.
   */
  async get(pathAndQuery: string, label: string): Promise<unknown | null> {
    if (this.used >= REQUEST_BUDGET) {
      throw new Error(`request budget of ${REQUEST_BUDGET} exhausted before ${label}`);
    }
    const since = Date.now() - this.lastRequestAt;
    if (this.lastRequestAt !== 0 && since < REQUEST_DELAY_MS) {
      await sleep(REQUEST_DELAY_MS - since);
    }
    this.lastRequestAt = Date.now();
    this.used += 1;

    const res = await fetch(`${API_BASE}${pathAndQuery}`, {
      headers: { "X-API-KEY": this.key, "User-Agent": USER_AGENT, Accept: "application/json" },
    });

    if (res.status === 404) {
      warn(`${label}: not found`);
      return null;
    }
    if (res.status === 429) {
      throw new Error(`${label}: rate limited (HTTP 429) — the daily or per-minute cap was hit`);
    }
    if (!res.ok) {
      throw new Error(`${label}: HTTP ${res.status}`);
    }
    return (await res.json()) as unknown;
  }
}

/**
 * Turns the jurisdiction's session list into our SessionInfo.
 *
 * The API has no "in session" boolean, so it is inferred from dates. Sessions
 * with no end_date are treated as open only if none started more recently, which
 * keeps a year-round legislature reading as in session without also reviving an
 * old session that was never closed out.
 */
function sessionInfoFrom(sessions: unknown[], today: string): SessionInfo {
  interface Session {
    id: string;
    label: string;
    start: string;
    end: string | null;
  }

  const parsed: Session[] = [];
  for (const raw of sessions) {
    if (!isRecord(raw)) continue;
    const id = str(raw["identifier"]);
    const start = str(raw["start_date"]);
    if (!id || !start) continue;
    parsed.push({ id, label: str(raw["name"]) ?? id, start, end: str(raw["end_date"]) });
  }
  parsed.sort((a, b) => a.start.localeCompare(b.start));

  const started = parsed.filter((s) => s.start <= today);
  const mostRecent = started[started.length - 1] ?? null;
  const future = parsed.find((s) => s.start > today) ?? null;
  const next = future ? { id: future.id, label: future.label, convenes: future.start } : null;

  if (!mostRecent) {
    return { id: null, label: "", convenes: null, inSession: false, next };
  }

  const inSession = mostRecent.end === null || today <= mostRecent.end;
  return {
    id: mostRecent.id,
    label: mostRecent.label,
    convenes: mostRecent.start,
    inSession,
    next,
  };
}

/** Reads the committee (or chamber) that will actually be taking the vote. */
function resolveBody(
  event: Record<string, unknown>,
  committees: Committee[],
  juris: Jurisdiction,
  fallbackSourceUrl: string,
): { body: VoteEvent["body"]; voterIds: string[]; kind: VoteEvent["kind"] } {
  const organizations = arr(event["participants"])
    .filter(isRecord)
    .filter((p) => str(p["entity_type"]) === "organization");

  const byId = new Map(committees.map((c) => [c.id, c]));
  const byName = new Map(committees.map((c) => [c.name.toLowerCase(), c]));

  for (const participant of organizations) {
    const name = str(participant["name"]);
    const org = isRecord(participant["organization"]) ? participant["organization"] : null;
    const orgId = org ? str(org["id"]) : null;

    const matched =
      (orgId ? byId.get(orgId) : undefined) ??
      (name ? byName.get(name.toLowerCase()) : undefined) ??
      (name
        ? committees.find(
            (c) =>
              c.name.toLowerCase().includes(name.toLowerCase()) ||
              name.toLowerCase().includes(c.name.toLowerCase()),
          )
        : undefined);

    if (matched) {
      return {
        body: {
          type: "committee",
          id: matched.id,
          name: matched.name,
          officialUrl: matched.officialUrl,
        },
        voterIds: matched.members,
        kind: "committee",
      };
    }

    if (name) {
      // A whole-chamber participant means a floor vote. Rare in OpenStates —
      // its event scrapers almost only cover committee hearings.
      const isChamber = /^(the )?(house|senate|assembly|legislature|council)( of .*)?$/i.test(name);
      return {
        body: {
          type: isChamber ? "chamber" : "committee",
          id: orgId ?? name,
          name,
          officialUrl: fallbackSourceUrl,
        },
        voterIds: [],
        kind: isChamber ? "floor" : "committee",
      };
    }
  }

  return {
    body: {
      type: "committee",
      id: str(event["id"]) ?? "event",
      name: str(event["name"]) ?? `${juris.legislatureName} hearing`,
      officialUrl: fallbackSourceUrl,
    },
    voterIds: [],
    kind: "committee",
  };
}

interface EventBillRef {
  identifier: string;
  event: Record<string, unknown>;
  body: ReturnType<typeof resolveBody>;
  sourceUrl: string;
}

/** Pulls every bill reference off every agenda item of the fetched events. */
function collectBillRefs(
  events: unknown[],
  committees: Committee[],
  juris: Jurisdiction,
): EventBillRef[] {
  const refs: EventBillRef[] = [];

  for (const raw of events) {
    if (!isRecord(raw)) continue;

    const sourceUrls = [...arr(raw["sources"]), ...arr(raw["links"])]
      .filter(isRecord)
      .map((s) => str(s["url"]))
      .filter((u): u is string => u !== null);
    const sourceUrl = sourceUrls[0] ?? juris.url;

    const body = resolveBody(raw, committees, juris, sourceUrl);

    const seen = new Set<string>();
    for (const item of arr(raw["agenda"])) {
      if (!isRecord(item)) continue;
      for (const related of arr(item["related_entities"])) {
        if (!isRecord(related)) continue;
        if (str(related["entity_type"]) !== "bill") continue;
        const identifier = str(related["name"]);
        if (!identifier || seen.has(identifier)) continue;
        seen.add(identifier);
        refs.push({ identifier, event: raw, body, sourceUrl });
      }
    }
  }

  return refs;
}

async function runCalendars(targets: Jurisdiction[], apiKey: string): Promise<void> {
  const now = new Date();
  const today = isoDate(now);
  const api = new ApiClient(apiKey);

  // Rotate the starting point so a budget stop does not always strand the same
  // states at the end of the alphabet.
  const dayOfYear = Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      Date.UTC(now.getUTCFullYear(), 0, 1)) /
      86_400_000,
  );
  const offset = targets.length > 0 ? dayOfYear % targets.length : 0;
  const ordered = [...targets.slice(offset), ...targets.slice(0, offset)];
  log(
    `calendars: ${ordered.length} jurisdictions, starting at ${ordered[0]?.code ?? "-"} (day ${dayOfYear})`,
  );

  const processed: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const [index, juris] of ordered.entries()) {
    // A state needs its jurisdiction call plus at least one events page to be
    // worth starting; anything less would write a half-truth.
    if (api.requestsLeft < 3) {
      skipped.push(...ordered.slice(index).map((j) => j.code));
      break;
    }

    try {
      // 1. Sessions.
      const jurisdiction = await api.get(
        `/jurisdictions/${encodeURIComponent(juris.jurisdictionId)}?include=legislative_sessions`,
        `${juris.code} jurisdiction`,
      );
      const session = isRecord(jurisdiction)
        ? sessionInfoFrom(arr(jurisdiction["legislative_sessions"]), today)
        : unknownSession();

      // 2. Upcoming events that reference at least one bill.
      const events: unknown[] = [];
      for (let page = 1; page <= MAX_EVENT_PAGES; page += 1) {
        if (api.requestsLeft < 1) break;
        const query = new URLSearchParams({
          jurisdiction: juris.jurisdictionId,
          after: today,
          require_bills: "true",
          include: "participants,agenda,links,sources",
          page: String(page),
          per_page: "20",
        });
        const payload = await api.get(
          `/events?${query.toString()}`,
          `${juris.code} events p${page}`,
        );
        if (!isRecord(payload)) break;
        const results = arr(payload["results"]);
        events.push(...results);

        const pagination = isRecord(payload["pagination"]) ? payload["pagination"] : null;
        const maxPage = pagination ? Number(pagination["max_page"] ?? 1) : 1;
        if (results.length === 0 || page >= maxPage) break;
      }

      const dir = path.join(DATA_ROOT, juris.slug);
      const committees = (await readJsonFile<Committee[]>(path.join(dir, "committees.json"))) ?? [];
      if (committees.length === 0) {
        warn(
          `${juris.code}: no committees.json — run --mode=roster first; voter lists will be empty`,
        );
      }

      const refs = collectBillRefs(events, committees, juris);

      // 3. Bill titles and official links. bills.json doubles as the cache, so a
      //    bill already stored for this session costs nothing on a repeat run.
      const storedBills = (await readJsonFile<Bill[]>(path.join(dir, "bills.json"))) ?? [];
      const billByKey = new Map(storedBills.map((b) => [`${b.session}|${b.number}`, b]));
      const bills: Bill[] = [];
      const resolved = new Map<string, Bill>();
      let fetchedBills = 0;

      for (const identifier of new Set(refs.map((r) => r.identifier))) {
        if (!session.id) break;
        const key = `${session.id}|${identifier}`;
        const cached = billByKey.get(key);
        if (cached) {
          resolved.set(identifier, cached);
          continue;
        }
        // Leave a little budget so the remaining states still get their sessions.
        if (api.requestsLeft < 2) {
          warn(
            `${juris.code}: budget too low to look up ${identifier} — event kept without a title`,
          );
          continue;
        }
        const detail = await api.get(
          `/bills/${encodeURIComponent(juris.jurisdictionId)}/${encodeURIComponent(session.id)}/${encodeURIComponent(identifier)}`,
          `${juris.code} bill ${identifier}`,
        );
        if (!isRecord(detail)) continue;
        const bill: Bill = {
          number: str(detail["identifier"]) ?? identifier,
          numberShort: str(detail["identifier"]) ?? identifier,
          title: str(detail["title"]) ?? "",
          session: str(detail["session"]) ?? session.id,
          url: str(detail["openstates_url"]) ?? juris.url,
          sponsorName: null,
          lastAction: null,
          lastActionDate: null,
          trackingID: str(detail["id"]),
          updatetime: str(detail["updated_at"]),
        };
        resolved.set(identifier, bill);
        fetchedBills += 1;
      }

      for (const bill of resolved.values()) bills.push(bill);
      bills.sort((a, b) => a.number.localeCompare(b.number));

      // 4. Vote events.
      const voteEvents: VoteEvent[] = [];
      for (const ref of refs) {
        const bill = resolved.get(ref.identifier);
        const when = str(ref.event["start_date"]);
        const location = isRecord(ref.event["location"]) ? ref.event["location"] : null;
        voteEvents.push({
          kind: ref.body.kind,
          billNumber: ref.identifier,
          billTitle: bill?.title ?? "",
          billUrl: bill?.url ?? ref.sourceUrl,
          session: bill?.session ?? session.id ?? "",
          // Passed through as published: OpenStates start_date is sometimes
          // date-only, which the page already handles.
          when,
          whereLabel: (location ? str(location["name"]) : null) ?? "",
          body: ref.body.body,
          voterIds: ref.body.voterIds,
          sourceUrl: ref.sourceUrl,
        });
      }
      voteEvents.sort((a, b) => {
        if (a.when && b.when) return a.when.localeCompare(b.when);
        if (a.when) return -1;
        if (b.when) return 1;
        return a.billNumber.localeCompare(b.billNumber);
      });

      const changedBills = await writeJsonIfChanged(path.join(dir, "bills.json"), bills);
      const changedEvents = await writeJsonIfChanged(
        path.join(dir, "vote-events.json"),
        voteEvents,
      );

      const existing = await loadMeta(juris.slug);
      const sessionChanged = JSON.stringify(existing?.session) !== JSON.stringify(session);
      await saveMeta(
        juris,
        existing,
        {
          session,
          counts: { bills: bills.length, voteEvents: voteEvents.length },
          touchedCalendars: true,
          changed: changedBills || changedEvents || sessionChanged,
        },
        now,
      );

      processed.push(juris.code);
      log(
        `${juris.code} ${juris.slug}: session ${session.id ?? "unknown"} (${session.inSession ? "in session" : "adjourned"}), ${events.length} events, ${voteEvents.length} vote events, ${bills.length} bills (${fetchedBills} fetched) — ${api.requestsUsed} requests used`,
      );
    } catch (err) {
      failed.push(juris.code);
      warn(`${juris.code}: calendars failed — ${String(err)} (previous data left in place)`);
      // A budget or rate-limit failure will hit every remaining state too.
      if (String(err).includes("budget") || String(err).includes("429")) {
        skipped.push(...ordered.slice(index + 1).map((j) => j.code));
        break;
      }
    }
  }

  log(`calendars done — ${api.requestsUsed} of ${REQUEST_BUDGET} budgeted requests used`);
  log(`processed ${processed.length}: ${processed.join(",") || "(none)"}`);
  if (failed.length > 0) warn(`failed ${failed.length}: ${failed.join(",")}`);
  if (skipped.length > 0) {
    warn(
      `SKIPPED ${skipped.length} jurisdiction(s) — this run is PARTIAL, their data is unchanged from the last run: ${skipped.join(",")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function parseStatesFilter(value: string | undefined): Jurisdiction[] {
  if (!value) return JURISDICTIONS;
  const wanted = new Set(
    value
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const matched = JURISDICTIONS.filter((j) => wanted.has(j.postal) || wanted.has(j.slug));
  const unknown = [...wanted].filter(
    (w) => !JURISDICTIONS.some((j) => j.postal === w || j.slug === w),
  );
  if (unknown.length > 0) {
    warn(`--states listed unknown jurisdiction(s): ${unknown.join(",")} (Utah uses fetch-utah.ts)`);
  }
  return matched;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.find((a) => a.startsWith("--mode="))?.split("=")[1];
  const statesArg = args.find((a) => a.startsWith("--states="))?.split("=")[1];

  if (mode !== "roster" && mode !== "calendars") {
    console.error(
      "Usage: node scripts/fetch-states.ts --mode=roster|calendars [--states=ca,ne,dc]",
    );
    process.exit(2);
  }

  const targets = parseStatesFilter(statesArg);
  if (targets.length === 0) {
    console.error("No matching jurisdictions.");
    process.exit(2);
  }

  log(`mode=${mode} jurisdictions=${targets.length}`);

  if (mode === "roster") {
    await runRoster(targets);
  } else {
    const apiKey = process.env["OPENSTATES_API_KEY"];
    if (!apiKey) {
      console.error(
        "[fetch-states] FAILED: OPENSTATES_API_KEY is not set. Calendars mode cannot run without it.\n" +
          "  Get a free key at https://open.pluralpolicy.com/accounts/profile/ and set it as the\n" +
          "  OPENSTATES_API_KEY environment variable (repository secret for the workflow).",
      );
      process.exit(1);
    }
    await runCalendars(targets, apiKey);
  }

  log("done");
}

main().catch((err) => {
  console.error("[fetch-states] FAILED:", err);
  process.exit(1);
});
