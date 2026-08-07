import { useState } from "react";

import PartyTag from "@/components/PartyTag";
import type { Legislator } from "@/lib/types";

const COLLAPSED_COUNT = 8;

function initials(name: string): string {
  const parts = name.replace(/,/g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

function Portrait({ legislator }: { legislator: Legislator }) {
  const [failed, setFailed] = useState(false);

  if (!legislator.imageUrl || failed) {
    return (
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stategray text-[11px] font-medium text-inksec"
      >
        {initials(legislator.name)}
      </span>
    );
  }
  return (
    <img
      src={legislator.imageUrl}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-8 w-8 shrink-0 rounded-full bg-stategray object-cover"
    />
  );
}

interface LegislatorListProps {
  legislators: Legislator[];
  /** Describes the group for screen readers, e.g. "Utah House". */
  label: string;
}

/**
 * The "who votes" list. A floor vote means the whole chamber, which is 75
 * names — so everything past the first eight is behind a disclosure.
 */
export default function LegislatorList({ legislators, label }: LegislatorListProps) {
  const [expanded, setExpanded] = useState(false);

  if (legislators.length === 0) {
    return <p className="text-[15px] text-inksec">Voting membership not published for this event.</p>;
  }

  const hidden = legislators.length - COLLAPSED_COUNT;
  const shown = expanded ? legislators : legislators.slice(0, COLLAPSED_COUNT);

  return (
    <div>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {shown.map((leg) => (
          <li key={leg.id} className="flex items-center gap-3">
            <Portrait legislator={leg} />
            <span className="min-w-0 text-[15px]">
              <a
                href={leg.bioUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-hairline underline-offset-4 transition-colors hover:decoration-ink"
              >
                {leg.name}
              </a>{" "}
              <PartyTag party={leg.party} />
              {leg.district && (
                <span className="text-[13px] text-inksec"> · District {leg.district}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-3 text-[15px] text-stategreen underline decoration-transparent underline-offset-4 transition-colors hover:decoration-stategreen"
        >
          {expanded ? "Show fewer" : `Show all ${legislators.length} →`}
          <span className="sr-only"> members of {label}</span>
        </button>
      )}
    </div>
  );
}
