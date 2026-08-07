import { useMemo } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";

import SiteFooter from "@/components/SiteFooter";
import SourceLink from "@/components/SourceLink";
import VoteEventCard from "@/components/VoteEventCard";
import { stateBySlug } from "@/config/states";
import { stateData } from "@/data";
import type { VoteEvent } from "@/lib/types";
import NotFound from "@/components/NotFound";

function dayKey(event: VoteEvent): string {
  return event.when ? event.when.slice(0, 10) : "unscheduled";
}

function formatDay(key: string): string {
  if (key === "unscheduled") return "Date not yet scheduled";
  const d = new Date(`${key}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatConvenes(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export const Route = createFileRoute("/$stateSlug")({
  head: ({ params }) => {
    const config = stateBySlug(params.stateSlug);
    const enabled = Boolean(config?.enabled);
    const title = config && enabled ? `${config.name} — Be Informed` : "Not found — Be Informed";
    return {
      meta: [
        { title },
        {
          name: "description",
          content: config
            ? `What laws ${config.name} is voting on, who is voting, and when — linked to official state sources.`
            : "That state is not covered yet. Utah is the first state available on Be Informed.",
        },
        { property: "og:title", content: title },
        {
          property: "og:description",
          content:
            "Official state legislative data: what's being voted on, who votes, and when.",
        },
        { property: "og:type", content: "website" },
        { property: "og:url", content: `https://www.humanbeinginformed.com/${config?.slug ?? ""}` },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: StatePage,
});

function StatePage() {
  const { stateSlug } = useParams({ from: "/$stateSlug" });
  const config = stateBySlug(stateSlug);
  const data = config?.enabled ? stateData(config.slug) : null;

  const legislatorsById = useMemo(
    () => new Map((data?.legislators ?? []).map((l) => [l.id, l])),
    [data],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, VoteEvent[]>();
    for (const event of data?.voteEvents ?? []) {
      const key = dayKey(event);
      const bucket = map.get(key);
      if (bucket) bucket.push(event);
      else map.set(key, [event]);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "unscheduled") return 1;
      if (b === "unscheduled") return -1;
      return a.localeCompare(b);
    });
  }, [data]);

  // Unknown slug, or a state we have not turned on yet.
  if (!config || !config.enabled || !data) return <NotFound />;

  const { meta } = data;
  const next = meta.session.next;

  return (
    <main className="mx-auto min-h-screen max-w-[820px] px-6 py-16">
      <Link
        to="/"
        className="text-[15px] text-inksec transition-colors hover:text-ink"
      >
        ← Be Informed
      </Link>

      <h1 className="mt-6 text-[40px] font-semibold tracking-tight text-ink">{config.name}</h1>
      <p className="mt-2 text-[17px] text-inksec">
        {meta.session.inSession
          ? `${meta.session.label} — live floor calendars and committee agendas`
          : `${meta.session.label} — adjourned`}
      </p>

      {grouped.length === 0 ? (
        <section className="mt-14 border-t border-hairline pt-10">
          <h2 className="text-[21px] font-semibold text-ink">Nothing is scheduled for a vote</h2>
          <p className="mt-3 max-w-prose text-[17px] leading-relaxed text-inksec">
            The Utah Legislature is not currently in session.
            {next && ` The ${next.label} convenes ${formatConvenes(next.convenes)}.`}
          </p>
          <p className="mt-4 text-[15px]">
            <SourceLink href={meta.source.url}>le.utah.gov</SourceLink>
          </p>
          <p className="mt-10 text-[15px] text-inksec">
            {meta.counts.legislators} legislators and {meta.counts.committees} committees are on
            file and will be listed against each bill once floor calendars and committee agendas
            reopen.
          </p>
        </section>
      ) : (
        <div className="mt-14">
          {grouped.map(([key, events]) => (
            <section key={key} className="mb-10">
              <h2 className="text-[15px] font-semibold uppercase tracking-wide text-inksec">
                {formatDay(key)}
              </h2>
              {events.map((event) => (
                <VoteEventCard
                  key={`${event.kind}-${event.billNumber}-${event.body.id}-${event.when ?? "na"}`}
                  event={event}
                  legislatorsById={legislatorsById}
                />
              ))}
            </section>
          ))}
        </div>
      )}

      <SiteFooter meta={meta} />
    </main>
  );
}
