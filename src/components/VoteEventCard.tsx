import LegislatorList from "@/components/LegislatorList";
import SourceLink from "@/components/SourceLink";
import type { Legislator, VoteEvent } from "@/lib/types";

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

interface VoteEventCardProps {
  event: VoteEvent;
  /** The full roster, used to resolve `voterIds` into people. */
  legislatorsById: Map<string, Legislator>;
}

/** One bill, one upcoming vote: what it is, when it happens, and who votes. */
export default function VoteEventCard({ event, legislatorsById }: VoteEventCardProps) {
  const voters = event.voterIds
    .map((id) => legislatorsById.get(id))
    .filter((l): l is Legislator => Boolean(l));

  const time = formatTime(event.when);
  const kindLabel = event.kind === "floor" ? "Floor vote" : "Committee vote";

  return (
    <article className="border-t border-hairline py-8">
      <p className="text-[13px] uppercase tracking-wide text-inksec">{kindLabel}</p>

      <h3 className="mt-2 text-[21px] font-semibold leading-snug text-ink">
        <SourceLink href={event.billUrl}>
          {event.billNumber}
          {event.billTitle && <span className="font-normal"> — {event.billTitle}</span>}
        </SourceLink>
      </h3>

      <dl className="mt-4 space-y-1 text-[15px] text-inksec">
        <div className="flex gap-2">
          <dt className="w-14 shrink-0">When</dt>
          <dd className="text-ink">
            {time ? time : "Time not set — item is on the calendar in order"}
            {event.whereLabel && <span className="text-inksec"> · {event.whereLabel}</span>}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0">Who</dt>
          <dd className="text-ink">
            <SourceLink href={event.body.officialUrl}>{event.body.name}</SourceLink>
            <span className="text-inksec">
              {" "}
              · {voters.length} {voters.length === 1 ? "member" : "members"}
            </span>
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0">Source</dt>
          <dd className="text-ink">
            <SourceLink href={event.sourceUrl}>
              {event.kind === "floor" ? "Reading calendar" : "Committee agenda"}
            </SourceLink>
          </dd>
        </div>
      </dl>

      <div className="mt-5">
        <LegislatorList legislators={voters} label={event.body.name} />
      </div>
    </article>
  );
}
