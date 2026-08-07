import type { PartyCode } from "@/lib/types";

/**
 * Party is stated, never emphasized — muted text only, no fills. Utah's roster
 * currently carries R, D and F (Forward), so anything unrecognized falls
 * through to a neutral treatment rather than being dropped.
 */
const PARTY_NAMES: Record<string, string> = {
  R: "Republican",
  D: "Democrat",
  F: "Forward",
  I: "Independent",
  L: "Libertarian",
  U: "Unaffiliated",
};

const PARTY_COLORS: Record<string, string> = {
  R: "text-[#A3373C]",
  D: "text-[#2A5CA5]",
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
