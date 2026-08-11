import type { PartyCode } from "@/lib/types";

/**
 * Party is stated, never emphasized — muted text only, no fills. Codes come
 * straight from the states, so the list below is a courtesy expansion rather
 * than a whitelist: anything unrecognized falls through to a neutral treatment
 * rather than being dropped.
 */
const PARTY_NAMES: Record<string, string> = {
  R: "Republican",
  D: "Democrat",
  F: "Forward",
  I: "Independent",
  L: "Libertarian",
  U: "Unaffiliated",
  N: "Nonpartisan",
  G: "Green",
  P: "Progressive",
  C: "Conservative",
  W: "Working Families",
  DFL: "Democratic-Farmer-Labor",
  IP: "Independence",
  NPA: "No Party Affiliation",
};

const PARTY_COLORS: Record<string, string> = {
  R: "text-party-r",
  D: "text-party-d",
};

export default function PartyTag({ party }: { party: PartyCode }) {
  const code = (party ?? "").trim();
  if (!code) return null;
  const full = PARTY_NAMES[code];
  return (
    <span
      className={`text-[13px] tabular-nums ${PARTY_COLORS[code] ?? "text-inksec"}`}
      title={full ?? `Party: ${code}`}
    >
      ({code})
    </span>
  );
}
