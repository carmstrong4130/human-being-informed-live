/**
 * fetch-utah.ts — pulls Utah legislative data from the state's official JSON API
 * and writes normalized snapshots into `src/data/utah/`.
 *
 *   npx tsx scripts/fetch-utah.ts --mode=roster      # legislators + committees + portraits (daily)
 *   npx tsx scripts/fetch-utah.ts --mode=calendars   # bills + upcoming vote events (every 3h)
 *   npx tsx scripts/fetch-utah.ts --mode=roster --force-photos
 *
 * Token: `UTAH_LEG_TOKEN` env var, falling back to the Legislature's public demo
 * token `5678`. See README — a real token should be requested by phone.
 *
 * The Legislature publishes rate guidance on https://le.utah.gov/data/developer.htm:
 * legislators once a day, committees / meeting calendar three times a day,
 * reading calendar and bills once an hour. The two workflow schedules stay well
 * inside that; every request is sequential with a delay.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  Bill,
  Chamber,
  Committee,
  Legislator,
  SessionInfo,
  StateMeta,
  VoteEvent,
} from "../src/lib/types.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TOKEN = process.env["UTAH_LEG_TOKEN"] ?? "5678";
const GLEN = "https://glen.le.utah.gov";
const LE = "https://le.utah.gov";
const USER_AGENT = "humanbeinginformed.com data fetcher (contact: hello@humanbeinginformed.com)";
const REQUEST_DELAY_MS = 1000;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "src", "data", "utah");
const PHOTO_DIR = path.join(ROOT, "public", "legislators");

const SOURCE = { name: "Utah State Legislature", url: "https://le.utah.gov" };

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(...args: unknown[]) {
  console.log("[fetch-utah]", ...args);
}

function warn(...args: unknown[]) {
  console.warn("[fetch-utah] WARN", ...args);
}

let lastRequestAt = 0;

async function politeFetch(url: string, accept = "application/json"): Promise<Response> {
  const since = Date.now() - lastRequestAt;
  if (since < REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS - since);
  lastRequestAt = Date.now();
  return fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: accept } });
}

/**
 * GET a JSON endpoint. The API answers unknown sessions with a 200 and the
 * plain-text body "Invalid request", so a parse failure is a normal, expected
 * outcome — it is reported as null rather than thrown.
 */
async function getJson<T = unknown>(url: string, label: string): Promise<T | null> {
  const shown = url.replace(TOKEN, "<token>");
  let res: Response;
  try {
    res = await politeFetch(url);
  } catch (err) {
    throw new Error(`${label}: network failure for ${shown} — ${String(err)}`);
  }
  if (!res.ok) {
    warn(`${label}: HTTP ${res.status} for ${shown}`);
    return null;
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    warn(`${label}: non-JSON response for ${shown} (${text.slice(0, 60).trim()})`);
    return null;
  }
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reads the first present key from a loosely-typed API object. */
function pick(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Utah session calendar
// ---------------------------------------------------------------------------

/**
 * Utah's General Session convenes on the third Tuesday of January and runs 45
 * calendar days (Utah Constitution art. VI §16).
 */
function generalSessionStart(year: number): Date {
  const d = new Date(Date.UTC(year, 0, 1));
  // 2 === Tuesday
  const offsetToFirstTuesday = (2 - d.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, 0, 1 + offsetToFirstTuesday + 14));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function generalSessionWindow(year: number): { start: Date; end: Date } {
  const start = generalSessionStart(year);
  const end = new Date(start.getTime() + 44 * 86_400_000);
  return { start, end };
}

function nextGeneralSession(now: Date): { id: string; label: string; convenes: string } {
  const year = now.getUTCFullYear();
  const thisYear = generalSessionWindow(year);
  const target = now <= thisYear.end ? year : year + 1;
  return {
    id: `${target}GS`,
    label: `${target} General Session`,
    convenes: isoDate(generalSessionStart(target)),
  };
}

function sessionLabel(id: string): string {
  const m = /^(\d{4})(GS|S(\d+))$/.exec(id);
  if (!m) return id;
  const [, year, kind, n] = m;
  return kind === "GS" ? `${year} General Session` : `${year} Special Session ${n}`;
}

// ---------------------------------------------------------------------------
// Link construction (§4.2 of PLAN.md — every entity links to its official page)
// ---------------------------------------------------------------------------

function billUrl(session: string, billNumber: string): string {
  const year = session.slice(0, 4);
  return `${LE}/~${year}/bills/static/${billNumber}.html`;
}

function bioUrl(chamber: Chamber, id: string): string {
  return chamber === "house"
    ? `https://house.utleg.gov/rep/${id}/`
    : `https://senate.utah.gov/sen/${id}/`;
}

function chamberFromHouseCode(code: unknown): Chamber | null {
  if (code === "H") return "house";
  if (code === "S") return "senate";
  return null;
}

function chamberFromName(name: string): Chamber | null {
  const n = name.toLowerCase();
  if (n.startsWith("house") || n.includes("house ")) return "house";
  if (n.startsWith("senate") || n.includes("senate ")) return "senate";
  return null;
}

// Utah is bicameral, so the "legislature" arm of `Chamber` never occurs here —
// it is spelled out anyway so a future widening cannot silently mislabel a body.
function chamberLabel(chamber: Chamber): string {
  if (chamber === "house") return "House";
  if (chamber === "senate") return "Senate";
  return "Legislature";
}

function chamberOfficialUrl(chamber: Chamber): string {
  if (chamber === "house") return "https://house.utleg.gov/";
  if (chamber === "senate") return "https://senate.utah.gov/";
  return LE;
}

/**
 * Normalizes bill references such as "HB 60", "H.B. 60" or "HB0060" to "HB0060".
 * The state publishes these with non-breaking spaces, which `\s` does not match,
 * so those are folded to ordinary spaces first.
 */
function normalizeBillNumber(raw: string): string | null {
  const m = /\b([HS])\.?\s?([BJCR])\.?\s?R?\.?\s*0*(\d{1,4})\b/i.exec(raw.replace(/\u00a0/g, " "));
  if (m) {
    const [, house, kind, digits] = m;
    if (!house || !kind || !digits) return null;
    return `${house.toUpperCase()}${kind.toUpperCase()}${digits.padStart(4, "0")}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const META_FILE = path.join(DATA_DIR, "meta.json");

async function loadMeta(): Promise<StateMeta | null> {
  return readJsonFile<StateMeta>(META_FILE);
}

async function saveMeta(meta: StateMeta): Promise<boolean> {
  return writeJsonIfChanged(META_FILE, meta);
}

function emptyMeta(now: Date): StateMeta {
  const next = nextGeneralSession(now);
  return {
    lastUpdated: now.toISOString(),
    session: {
      id: null,
      label: next.label,
      convenes: null,
      inSession: false,
      next,
    },
    counts: { legislators: 0, committees: 0, bills: 0, voteEvents: 0 },
    source: SOURCE,
  };
}

// ---------------------------------------------------------------------------
// Mode: roster
// ---------------------------------------------------------------------------

interface RawLegislator {
  fullName?: string;
  formatName?: string;
  id?: string;
  image?: string;
  house?: string;
  party?: string;
  district?: string;
}

interface RawCommitteeMember {
  id?: string;
  name?: string;
  position?: string;
}

interface RawCommittee {
  id?: string;
  description?: string;
  link?: string;
  members?: RawCommitteeMember[];
}

async function downloadPortrait(url: string, dest: string): Promise<boolean> {
  try {
    // The image host rejects an `Accept: application/json` request with a 406.
    const res = await politeFetch(url, "image/jpeg,image/*;q=0.8,*/*;q=0.5");
    if (!res.ok) {
      warn(`portrait HTTP ${res.status} for ${url}`);
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // Anything tiny is an error page, not a photo.
    if (buf.length < 1024) {
      warn(`portrait suspiciously small (${buf.length} bytes) for ${url}`);
      return false;
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, buf);
    return true;
  } catch (err) {
    warn(`portrait failed for ${url} — ${String(err)}`);
    return false;
  }
}

async function runRoster(forcePhotos: boolean): Promise<void> {
  const now = new Date();

  // 1. Legislators (public endpoint, no token needed).
  const rosterRaw = await getJson<{ legislators?: RawLegislator[] } | RawLegislator[]>(
    `${LE}/data/legislators.json`,
    "legislators",
  );
  if (!rosterRaw) throw new Error("legislators.json could not be fetched");
  const rawLegislators: RawLegislator[] = Array.isArray(rosterRaw)
    ? rosterRaw
    : (rosterRaw.legislators ?? []);
  if (rawLegislators.length === 0) throw new Error("legislators.json returned no legislators");

  const legislators: Legislator[] = [];
  const portraitSources = new Map<string, string>();

  for (const raw of rawLegislators) {
    const id = raw.id?.trim();
    if (!id) continue;
    const chamber = chamberFromHouseCode(raw.house);
    if (!chamber) {
      warn(`legislator ${id} has unrecognized chamber code ${String(raw.house)} — skipped`);
      continue;
    }
    if (raw.image) portraitSources.set(id, raw.image);
    legislators.push({
      id,
      name: raw.formatName?.trim() || raw.fullName?.trim() || id,
      chamber,
      party: (raw.party ?? "").trim(),
      district: (raw.district ?? "").trim(),
      bioUrl: bioUrl(chamber, id),
      imageUrl: null, // filled in below once the file is known to exist
    });
  }
  log(`normalized ${legislators.length} legislators`);

  // 2. Portraits — only fetch what we do not already have on disk.
  let downloaded = 0;
  for (const leg of legislators) {
    const dest = path.join(PHOTO_DIR, `${leg.id}.jpg`);
    let exists = false;
    try {
      exists = (await fs.stat(dest)).size > 1024;
    } catch {
      exists = false;
    }
    if (!exists || forcePhotos) {
      const src = portraitSources.get(leg.id) ?? `${LE}/images/legislator/${leg.id}.jpg`;
      if (await downloadPortrait(src, dest)) {
        downloaded += 1;
        exists = true;
      }
    }
    leg.imageUrl = exists ? `/legislators/${leg.id}.jpg` : null;
  }
  log(
    `portraits: ${downloaded} downloaded, ${legislators.filter((l) => l.imageUrl).length} on disk`,
  );

  // 3. Committees + membership.
  const committeesRaw = await getJson<{ committees?: RawCommittee[] }>(
    `${GLEN}/committees/${TOKEN}`,
    "committees",
  );
  const committees: Committee[] = [];
  for (const raw of committeesRaw?.committees ?? []) {
    const id = raw.id?.trim();
    const name = raw.description?.trim();
    if (!id || !name) continue;
    committees.push({
      id,
      name,
      chamber: chamberFromName(name),
      members: (raw.members ?? []).map((m) => m.id?.trim()).filter((v): v is string => Boolean(v)),
      officialUrl:
        raw.link?.trim() || `${LE}/committee/committee.jsp?year=${now.getUTCFullYear()}&com=${id}`,
    });
  }
  log(`normalized ${committees.length} committees`);

  // 4. Write.
  const changedLegislators = await writeJsonIfChanged(
    path.join(DATA_DIR, "legislators.json"),
    legislators,
  );
  const changedCommittees = await writeJsonIfChanged(
    path.join(DATA_DIR, "committees.json"),
    committees,
  );

  const meta = (await loadMeta()) ?? emptyMeta(now);
  meta.counts.legislators = legislators.length;
  meta.counts.committees = committees.length;
  meta.session.next = nextGeneralSession(now);
  meta.source = SOURCE;
  if (changedLegislators || changedCommittees) {
    meta.lastUpdated = now.toISOString();
    meta.lastUpdatedRoster = now.toISOString();
  }
  await saveMeta(meta);

  log(
    changedLegislators || changedCommittees
      ? "roster data changed — files updated"
      : "roster unchanged",
  );
}

// ---------------------------------------------------------------------------
// Mode: calendars
// ---------------------------------------------------------------------------

interface BillListEntry {
  number?: string;
  trackingID?: string;
  updatetime?: string;
  lastActionTime?: string;
}

interface RawAgendaEntry {
  mtgID?: string;
  committeeID?: string;
  mtgDate?: string;
  mtgPlace?: string;
  committeeName?: string;
  upcomming?: boolean;
  agendaURL?: string;
  billSession?: string;
}

interface RawBillDetail {
  sessionID?: string;
  billNumber?: string;
  billNumberShort?: string;
  shortTitle?: string;
  primeSponsorName?: string;
  lastAction?: string;
  lastActionDate?: string;
  trackingID?: string;
  agendaList?: RawAgendaEntry[];
}

/**
 * §7 Q5 heuristic: build candidate session ids from the calendar, probe each
 * one's bill list (a non-existent session answers "Invalid request"), and keep
 * whichever non-empty session has the most recently updated bills.
 */
async function resolveSession(now: Date): Promise<{ id: string; bills: BillListEntry[] } | null> {
  const year = now.getUTCFullYear();
  const candidates = [`${year}GS`, `${year}S1`, `${year}S2`, `${year}S3`];
  // Before the third Tuesday of January the prior year's sessions are still the
  // most recent ones with data.
  if (now < generalSessionStart(year)) {
    candidates.push(`${year - 1}GS`, `${year - 1}S1`, `${year - 1}S2`, `${year - 1}S3`);
  }

  let best: { id: string; bills: BillListEntry[]; newest: string } | null = null;
  for (const id of candidates) {
    const list = await getJson<BillListEntry[]>(
      `${GLEN}/bills/${id}/billlist/${TOKEN}`,
      "billlist",
    );
    if (!Array.isArray(list) || list.length === 0) continue;
    const newest = list.reduce(
      (acc, b) => (b.updatetime && b.updatetime > acc ? b.updatetime : acc),
      "",
    );
    log(`session ${id}: ${list.length} bills, newest update ${newest || "unknown"}`);
    if (!best || newest > best.newest) best = { id, bills: list, newest };
  }
  return best ? { id: best.id, bills: best.bills } : null;
}

/**
 * The reading-calendar endpoint returns `{"calendars":[]}` out of session, so its
 * populated shape could not be verified live. This parser therefore accepts the
 * plausible field spellings and logs (rather than throws) on anything it cannot
 * read, so an unexpected shape degrades to "no floor events" instead of a red
 * workflow and a broken site.
 */
function parseFloorCalendars(
  payload: unknown,
): { name: string; chamber: Chamber | null; billNumbers: string[]; sourceUrl: string | null }[] {
  const out: {
    name: string;
    chamber: Chamber | null;
    billNumbers: string[];
    sourceUrl: string | null;
  }[] = [];
  const list = isRecord(payload)
    ? (payload["calendars"] ?? payload["calendar"] ?? payload["items"])
    : payload;
  if (!Array.isArray(list)) {
    if (list !== undefined)
      warn("calendars: unexpected payload shape", JSON.stringify(payload).slice(0, 300));
    return out;
  }

  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const name =
      pick(entry, ["name", "calendarName", "description", "calendar", "title"]) ??
      "Reading Calendar";
    const chamber =
      chamberFromHouseCode(entry["house"] ?? entry["chamber"]) ?? chamberFromName(name);
    const sourceUrl = pick(entry, ["link", "url", "calendarURL"]);

    const billsRaw =
      entry["bills"] ?? entry["billList"] ?? entry["items"] ?? entry["calendarItems"];
    const billNumbers: string[] = [];
    if (Array.isArray(billsRaw)) {
      for (const b of billsRaw) {
        if (typeof b === "string") {
          const n = normalizeBillNumber(b);
          if (n) billNumbers.push(n);
        } else if (isRecord(b)) {
          const raw = pick(b, ["number", "billNumber", "bill", "billNumberShort", "billid"]);
          const n = raw ? normalizeBillNumber(raw) : null;
          if (n) billNumbers.push(n);
        }
      }
    }
    if (billNumbers.length === 0) {
      warn(`calendars: "${name}" produced no readable bill numbers`);
      continue;
    }
    out.push({ name, chamber, billNumbers, sourceUrl });
  }
  return out;
}

/** Floor times come from the meeting calendar; committee rows are ignored here. */
function findFloorTime(legcalItems: unknown, chamber: Chamber, now: Date): string | null {
  if (!Array.isArray(legcalItems)) return null;
  let soonest: string | null = null;
  for (const item of legcalItems) {
    if (!isRecord(item)) continue;
    const label = pick(item, ["committee", "name", "description"]) ?? "";
    if (!/floor/i.test(label)) continue;
    if (chamberFromName(label) !== chamber) continue;
    const when = pick(item, ["mtgTime", "time", "date"]);
    if (!when) continue;
    const parsed = new Date(when);
    if (Number.isNaN(parsed.getTime()) || parsed < now) continue;
    if (!soonest || parsed < new Date(soonest)) soonest = parsed.toISOString();
  }
  return soonest;
}

/** Pulls bill numbers out of the agenda calendar, meeting by meeting. */
async function collectAgendaBills(
  now: Date,
): Promise<Map<string, { meeting: Record<string, unknown>; billNumbers: string[] }>> {
  const result = new Map<string, { meeting: Record<string, unknown>; billNumbers: string[] }>();
  const agencal = await getJson<Record<string, unknown>>(`${GLEN}/agencal/${TOKEN}`, "agencal");
  const mtgs = isRecord(agencal)
    ? (agencal["mtgs"] ?? agencal["meetings"] ?? agencal["items"])
    : null;
  if (!Array.isArray(mtgs) || mtgs.length === 0) {
    log("agenda calendar is empty");
    return result;
  }

  for (const mtg of mtgs) {
    if (!isRecord(mtg)) continue;
    const mtgID = pick(mtg, ["mtgID", "id", "meetingID"]);
    if (!mtgID) continue;
    const when = pick(mtg, ["mtgTime", "mtgDate", "time"]);
    if (when) {
      const parsed = new Date(when);
      // Past meetings cannot host an upcoming vote.
      if (!Number.isNaN(parsed.getTime()) && parsed < now) continue;
    }
    const detail = await getJson<Record<string, unknown>>(
      `${GLEN}/agencal/${mtgID}/${TOKEN}`,
      "agenda",
    );
    if (!detail) continue;
    const billNumbers = new Set<string>();
    const scan = (node: unknown, depth: number): void => {
      if (depth > 6) return;
      if (typeof node === "string") {
        const n = normalizeBillNumber(node);
        if (n) billNumbers.add(n);
      } else if (Array.isArray(node)) {
        for (const child of node) scan(child, depth + 1);
      } else if (isRecord(node)) {
        for (const child of Object.values(node)) scan(child, depth + 1);
      }
    };
    scan(detail, 0);
    result.set(mtgID, { meeting: mtg, billNumbers: [...billNumbers] });
  }
  return result;
}

async function runCalendars(): Promise<void> {
  const now = new Date();

  const legislators =
    (await readJsonFile<Legislator[]>(path.join(DATA_DIR, "legislators.json"))) ?? [];
  const committees =
    (await readJsonFile<Committee[]>(path.join(DATA_DIR, "committees.json"))) ?? [];
  if (legislators.length === 0) {
    warn(
      "no legislators.json on disk — run `npm run data:roster` first; floor voter lists will be empty",
    );
  }
  const committeeById = new Map(committees.map((c) => [c.id, c]));

  // 1. Which session are we in?
  const session = await resolveSession(now);
  if (!session) log("no session with bills found — treating as out of session");

  // 2. Upcoming floor calendars and committee agendas.
  const calendarsPayload = await getJson<unknown>(`${GLEN}/calendars/${TOKEN}`, "calendars");
  const floorCalendars = parseFloorCalendars(calendarsPayload);
  log(`floor calendars with bills: ${floorCalendars.length}`);

  const legcalPayload = await getJson<Record<string, unknown>>(`${GLEN}/legcal/${TOKEN}`, "legcal");
  const legcalItems = isRecord(legcalPayload) ? legcalPayload["items"] : null;

  const agendaMeetings = await collectAgendaBills(now);
  log(`agenda meetings with bills: ${agendaMeetings.size}`);

  // 3. Bill details — only for bills that appear somewhere upcoming, and only
  //    when the state's own updatetime says our stored copy is stale.
  const candidates = new Set<string>();
  for (const cal of floorCalendars) for (const n of cal.billNumbers) candidates.add(n);
  for (const { billNumbers } of agendaMeetings.values())
    for (const n of billNumbers) candidates.add(n);

  const storedBills = (await readJsonFile<Bill[]>(path.join(DATA_DIR, "bills.json"))) ?? [];
  const storedByNumber = new Map(storedBills.map((b) => [b.number, b]));
  const billListByNumber = new Map((session?.bills ?? []).map((b) => [b.number ?? "", b] as const));

  const bills: Bill[] = [];
  const details = new Map<string, RawBillDetail>();

  for (const number of [...candidates].sort()) {
    if (!session) break;
    const listEntry = billListByNumber.get(number);
    const stored = storedByNumber.get(number);
    const unchanged =
      stored &&
      stored.session === session.id &&
      listEntry?.updatetime &&
      stored.updatetime === listEntry.updatetime;

    if (unchanged) {
      bills.push(stored);
      continue;
    }
    const detail = await getJson<RawBillDetail>(
      `${GLEN}/bills/${session.id}/${number}/${TOKEN}`,
      "bill",
    );
    if (!detail || !detail.billNumber) {
      warn(`bill ${number}: no detail returned`);
      if (stored) bills.push(stored);
      continue;
    }
    details.set(number, detail);
    bills.push({
      number: detail.billNumber,
      numberShort: detail.billNumberShort ?? detail.billNumber,
      title: detail.shortTitle ?? "",
      session: detail.sessionID ?? session.id,
      url: billUrl(detail.sessionID ?? session.id, detail.billNumber),
      sponsorName: detail.primeSponsorName?.trim() || null,
      lastAction: detail.lastAction?.trim() || null,
      lastActionDate: detail.lastActionDate?.trim() || null,
      trackingID: detail.trackingID ?? null,
      updatetime: listEntry?.updatetime ?? null,
    });
  }
  log(`bills tracked: ${bills.length} (${details.size} freshly fetched)`);

  const billByNumber = new Map(bills.map((b) => [b.number, b]));

  // 4. Derive vote events.
  const voteEvents: VoteEvent[] = [];

  // 4a. Floor votes — everyone in the chamber votes.
  for (const cal of floorCalendars) {
    const chamber = cal.chamber;
    if (!chamber) {
      warn(`calendar "${cal.name}" has no identifiable chamber — skipped`);
      continue;
    }
    const when = findFloorTime(legcalItems, chamber, now);
    const voterIds = legislators.filter((l) => l.chamber === chamber).map((l) => l.id);
    for (const number of cal.billNumbers) {
      const bill = billByNumber.get(number);
      if (!bill) continue;
      voteEvents.push({
        kind: "floor",
        billNumber: bill.number,
        billTitle: bill.title,
        billUrl: bill.url,
        session: bill.session,
        when,
        whereLabel: cal.name,
        body: {
          type: "chamber",
          id: chamber,
          name: `Utah ${chamberLabel(chamber)}`,
          officialUrl: chamberOfficialUrl(chamber),
        },
        voterIds,
        sourceUrl: cal.sourceUrl ?? `${LE}/billlist.jsp?session=${bill.session}`,
      });
    }
  }

  // 4b. Committee votes — from each bill's own agenda list, which carries the
  //     `upcomming` flag (the API's spelling, not ours).
  for (const [number, detail] of details) {
    const bill = billByNumber.get(number);
    if (!bill) continue;
    for (const agenda of detail.agendaList ?? []) {
      if (!agenda.upcomming) continue;
      if (agenda.billSession && session && agenda.billSession !== session.id) continue;
      const committeeId = agenda.committeeID?.trim();
      const committee = committeeId ? committeeById.get(committeeId) : undefined;
      const when = agenda.mtgDate ? new Date(agenda.mtgDate.replace(" ", "T")) : null;
      voteEvents.push({
        kind: "committee",
        billNumber: bill.number,
        billTitle: bill.title,
        billUrl: bill.url,
        session: bill.session,
        when: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
        whereLabel: agenda.mtgPlace?.trim() || agenda.committeeName?.trim() || "Committee hearing",
        body: {
          type: "committee",
          id: committeeId ?? agenda.committeeName ?? "committee",
          name: committee?.name ?? agenda.committeeName ?? "Committee",
          officialUrl:
            committee?.officialUrl ??
            `${LE}/committee/committee.jsp?year=${now.getUTCFullYear()}&com=${committeeId ?? ""}`,
        },
        voterIds: committee?.members ?? [],
        sourceUrl: agenda.agendaURL
          ? `${LE}${agenda.agendaURL}`
          : (committee?.officialUrl ?? SOURCE.url),
      });
    }
  }

  // Soonest first; undated calendar items sort after dated ones.
  voteEvents.sort((a, b) => {
    if (a.when && b.when) return a.when.localeCompare(b.when);
    if (a.when) return -1;
    if (b.when) return 1;
    return a.billNumber.localeCompare(b.billNumber);
  });
  log(`vote events: ${voteEvents.length}`);

  // 5. Write.
  const changedBills = await writeJsonIfChanged(path.join(DATA_DIR, "bills.json"), bills);
  const changedEvents = await writeJsonIfChanged(
    path.join(DATA_DIR, "vote-events.json"),
    voteEvents,
  );

  const meta = (await loadMeta()) ?? emptyMeta(now);
  const window = session ? generalSessionWindow(Number(session.id.slice(0, 4))) : null;
  const inSession =
    voteEvents.length > 0 ||
    Boolean(window && session?.id.endsWith("GS") && now >= window.start && now <= window.end);

  const sessionInfo: SessionInfo = {
    id: session?.id ?? null,
    label: session ? sessionLabel(session.id) : meta.session.label,
    convenes: session?.id.endsWith("GS")
      ? isoDate(generalSessionStart(Number(session.id.slice(0, 4))))
      : null,
    inSession,
    next: nextGeneralSession(now),
  };
  meta.session = sessionInfo;
  meta.counts.bills = bills.length;
  meta.counts.voteEvents = voteEvents.length;
  meta.counts.legislators = legislators.length;
  meta.counts.committees = committees.length;
  meta.source = SOURCE;
  if (changedBills || changedEvents) {
    meta.lastUpdated = now.toISOString();
    meta.lastUpdatedCalendars = now.toISOString();
  }
  await saveMeta(meta);

  log(
    changedBills || changedEvents
      ? "calendar data changed — files updated"
      : "calendar data unchanged",
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith("--mode="))?.split("=")[1];
  const forcePhotos = args.includes("--force-photos");

  if (modeArg !== "roster" && modeArg !== "calendars") {
    console.error("Usage: tsx scripts/fetch-utah.ts --mode=roster|calendars [--force-photos]");
    process.exit(2);
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  log(`mode=${modeArg} token=${TOKEN === "5678" ? "demo (5678)" : "configured"}`);

  if (modeArg === "roster") await runRoster(forcePhotos);
  else await runCalendars();

  log("done");
}

main().catch((err) => {
  console.error("[fetch-utah] FAILED:", err);
  process.exit(1);
});
