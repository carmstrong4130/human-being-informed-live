/**
 * build-jurisdictions.ts — regenerates `scripts/jurisdictions.ts`.
 *
 *   node scripts/build-jurisdictions.ts
 *
 * Source of truth is OpenStates' own canonical jurisdiction metadata, which is
 * plain Python in a public repo and costs no API quota to read:
 *
 *   https://github.com/openstates/openstates-core/tree/main/openstates/metadata/data
 *
 * We only need four fields per jurisdiction (legislature name, homepage, the OCD
 * jurisdiction id, and whether it is unicameral), so this pulls them out with
 * regexes against the first `State(...)` literal in each file rather than trying
 * to interpret Python.
 *
 * The result is committed so the fetchers never depend on that repo's file
 * layout at data-refresh time. `fetch-states.ts --mode=calendars` refreshes each
 * state's name/url from the live OpenStates jurisdiction endpoint anyway; this
 * table is the seed and the offline fallback.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STATES } from "../src/config/states.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = path.join(ROOT, "scripts", "jurisdictions.ts");
const METADATA_BASE =
  "https://raw.githubusercontent.com/openstates/openstates-core/main/openstates/metadata/data";

/** Utah has its own bespoke fetcher against le.utah.gov and is not in this table. */
const BESPOKE = new Set(["UT"]);

/** `in` and `or` are Python keywords, so those two files are named around them. */
const FILE_OVERRIDES: Record<string, string> = { IN: "ind", OR: "ore" };

/**
 * OpenStates' `url` field is sometimes the statewide portal (mass.gov,
 * myflorida.com, state.mn.us) or an address that no longer resolves
 * (w3.legis.state.ak.us). Since this URL is what the site shows readers as the
 * official source, these point at the legislative body itself instead. Every
 * value here was checked to load before being added; anything not listed keeps
 * whatever OpenStates publishes.
 */
const URL_OVERRIDES: Record<string, string> = {
  AK: "https://www.akleg.gov", // published w3.legis.state.ak.us no longer resolves
  CA: "https://leginfo.legislature.ca.gov", // published www.legislature.ca.gov does not answer
  DC: "https://dccouncil.gov", // published dc.gov is the city portal
  FL: "https://www.leg.state.fl.us", // published myflorida.com is the state portal
  HI: "https://www.capitol.hawaii.gov",
  KY: "https://legislature.ky.gov", // published www.lrc.ky.gov is the research commission
  MA: "https://malegislature.gov", // published mass.gov is the state portal
  MN: "https://www.leg.mn.gov", // published state.mn.us is the state portal
  MO: "https://www.moga.mo.gov", // see ACCEPTED_UNREACHABLE
  NC: "https://www.ncleg.gov", // ncleg.net redirects here
  OR: "https://www.oregonlegislature.gov", // published olis.leg.state.or.us no longer resolves
  OH: "https://www.legislature.ohio.gov", // canonical, replaces legislature.state.oh.us
  RI: "https://www.rilegislature.gov", // published ri.gov is the state portal
  WV: "https://www.wvlegislature.gov",
  WY: "https://wyoleg.gov",
};

/** OpenStates' metadata has "New jersey Legislature" with a lowercase j. */
const NAME_OVERRIDES: Record<string, string> = {
  NJ: "New Jersey Legislature",
};

/**
 * Hosts that are known good but do not answer this script. moga.mo.gov resolves
 * to a real address (168.166.54.17) and is the Missouri General Assembly's own
 * site; it simply drops connections from unfamiliar clients. Listed here so the
 * check reports it as known rather than as something to fix.
 */
const ACCEPTED_UNREACHABLE = new Set(["MO"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(...args: unknown[]) {
  console.log("[build-jurisdictions]", ...args);
}

function warn(...args: unknown[]) {
  console.warn("[build-jurisdictions] WARN", ...args);
}

/** First `key="value"` in the file, which is the State(...) literal's own field. */
function firstField(source: string, key: string): string | null {
  const m = new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"`).exec(source);
  return m?.[1]?.trim() || null;
}

function tidyUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

const BROWSER_UA = "Mozilla/5.0 (compatible; humanbeinginformed.com source checker)";

type Reach = "ok" | "cert-chain" | "blocked" | "dead";

/**
 * Whether a URL is usable from a browser.
 *
 * Several legislature sites serve an incomplete certificate chain, which Node
 * rejects but browsers repair from their own intermediate store; a few others
 * answer 403 to anything that is not a real browser. Neither means the link is
 * broken, so they are reported separately from DNS/connect failures.
 */
async function reach(url: string): Promise<Reach> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": BROWSER_UA },
    });
    if (res.status === 403 || res.status === 429) return "blocked";
    return res.status < 400 ? "ok" : "dead";
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code ?? "";
    if (cause === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || cause === "SELF_SIGNED_CERT_IN_CHAIN") {
      return "cert-chain";
    }
    return "dead";
  }
}

/** Prefers https when the host serves it at all; otherwise keeps what OpenStates published. */
async function preferHttps(url: string): Promise<string> {
  const tidy = tidyUrl(url);
  if (tidy.startsWith("https://")) return tidy;
  const upgraded = tidy.replace(/^http:\/\//, "https://");
  const status = await reach(upgraded);
  if (status !== "dead") return upgraded;
  warn(`${upgraded} does not answer — keeping ${tidy}`);
  return tidy;
}

export interface JurisdictionSeed {
  code: string;
  postal: string;
  slug: string;
  stateName: string;
  legislatureName: string;
  url: string;
  jurisdictionId: string;
  unicameral: boolean;
}

async function main(): Promise<void> {
  const codes = Object.keys(STATES).filter((code) => !BESPOKE.has(code));
  log(`building table for ${codes.length} jurisdictions (Utah excluded — bespoke fetcher)`);

  const rows: JurisdictionSeed[] = [];

  for (const code of codes) {
    const config = STATES[code];
    if (!config) continue;
    const postal = code.toLowerCase();

    const res = await fetch(`${METADATA_BASE}/${FILE_OVERRIDES[code] ?? postal}.py`, {
      headers: { "User-Agent": "humanbeinginformed.com build script" },
    });
    if (!res.ok) {
      warn(`${code}: metadata HTTP ${res.status} — skipped`);
      continue;
    }
    const src = await res.text();

    const legislatureName = NAME_OVERRIDES[code] ?? firstField(src, "legislature_name");
    const divisionId = firstField(src, "division_id");
    const rawUrl = firstField(src, "url");
    const unicameral = /\bunicameral\s*=\s*True\b/.test(src);

    if (!legislatureName || !divisionId || !rawUrl) {
      warn(
        `${code}: could not read metadata (legislature_name=${legislatureName}, division_id=${divisionId}, url=${rawUrl}) — skipped`,
      );
      continue;
    }

    // ocd-division/country:us/state:al  →  ocd-jurisdiction/country:us/state:al/government
    const jurisdictionId = `${divisionId.replace(/^ocd-division/, "ocd-jurisdiction")}/government`;

    const override = URL_OVERRIDES[code];
    const url = override ? tidyUrl(override) : await preferHttps(rawUrl);

    rows.push({
      code,
      postal,
      slug: config.slug,
      stateName: config.name,
      legislatureName,
      url,
      jurisdictionId,
      unicameral,
    });
    log(`${code}  ${legislatureName}  ${url}  ${unicameral ? "unicameral" : "bicameral"}`);
    await sleep(100);
  }

  rows.sort((a, b) => a.code.localeCompare(b.code));

  // Every one of these URLs becomes a user-facing "official source" link, so
  // check them all rather than only the ones that were upgraded.
  log("verifying source links…");
  const dead: string[] = [];
  for (const r of rows) {
    const status = await reach(r.url);
    if (status === "dead" && ACCEPTED_UNREACHABLE.has(r.code)) {
      log(`${r.code}: ${r.url} — no answer here, known-good host (see ACCEPTED_UNREACHABLE)`);
    } else if (status === "dead") {
      dead.push(`${r.code} ${r.url}`);
      warn(`${r.code}: ${r.url} does not answer`);
    } else if (status !== "ok") {
      log(`${r.code}: ${r.url} — ${status} (fine in a browser)`);
    }
  }
  if (dead.length > 0) {
    warn(`${dead.length} source link(s) did not answer: ${dead.join(", ")}`);
    warn("add a URL_OVERRIDES entry for each after checking it by hand");
  } else {
    log("all source links answered");
  }

  const body = rows
    .map(
      (r) => `  {
    code: "${r.code}",
    postal: "${r.postal}",
    slug: "${r.slug}",
    stateName: ${JSON.stringify(r.stateName)},
    legislatureName: ${JSON.stringify(r.legislatureName)},
    url: ${JSON.stringify(r.url)},
    jurisdictionId: "${r.jurisdictionId}",
    unicameral: ${r.unicameral},
  },`,
    )
    .join("\n");

  const file = `/**
 * The jurisdictions covered by the national pipeline: all 50 states plus DC,
 * minus Utah (which has its own bespoke fetcher against le.utah.gov).
 *
 * GENERATED FILE — do not hand-edit. Regenerate with:
 *
 *   node scripts/build-jurisdictions.ts
 *
 * Field meanings and provenance are documented in that script.
 */

export interface Jurisdiction {
  /** Uppercase postal code, matching the keys of \`src/config/states.ts\`. */
  code: string;
  /** Lowercase postal code, used for \`openstates/people\` directory names. */
  postal: string;
  /** URL slug, matching \`src/config/states.ts\` and \`src/data/<slug>/\`. */
  slug: string;
  stateName: string;
  /** e.g. "Massachusetts General Court" — used for source attribution. */
  legislatureName: string;
  /** Official homepage, used as the fallback link for anything without its own URL. */
  url: string;
  /** OCD jurisdiction id for the OpenStates v3 API. */
  jurisdictionId: string;
  /** Nebraska and DC: one body, so roles carry chamber "legislature". */
  unicameral: boolean;
}

export const JURISDICTIONS: Jurisdiction[] = [
${body}
];

export const JURISDICTION_BY_CODE: Record<string, Jurisdiction> = Object.fromEntries(
  JURISDICTIONS.map((j) => [j.code, j]),
);
`;

  await fs.writeFile(OUT_FILE, file, "utf8");
  log(`wrote ${rows.length} jurisdictions to scripts/jurisdictions.ts`);
  if (rows.length !== codes.length) {
    warn(`expected ${codes.length} rows but wrote ${rows.length} — investigate the warnings above`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[build-jurisdictions] FAILED:", err);
  process.exit(1);
});
