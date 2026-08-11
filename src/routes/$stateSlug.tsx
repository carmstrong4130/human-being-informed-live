import { useMemo } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";

import SiteFooter from "@/components/SiteFooter";
import SourceLink from "@/components/SourceLink";
import VoteEventCard from "@/components/VoteEventCard";
import { stateBySlug } from "@/config/states";
import { stateData } from "@/data";
import type { StateMeta, VoteEvent } from "@/lib/types";
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

/** "https://www.leg.state.nv.us/" → "leg.state.nv.us", for the visible link text. */
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The session label, or null when no session has been resolved for this state yet. */
function sessionLabel(meta: StateMeta): string | null {
  const label = (meta.session.label ?? "").trim();
  return label === "" ? null : label;
}

export const Route = createFileRoute("/$stateSlug")({
  // The data folders are loaded lazily (one chunk per state), so this has to be
  // a loader rather than a synchronous read in the component. TanStack Start
  // runs it on the server for SSR and on the client for navigation.
  loader: async ({ params }) => {
    const config = stateBySlug(params.stateSlug);
    if (!config?.enabled) return null;
    return await stateData(config.slug);
  },
  head: ({ params }) => {
    const config = stateBySlug(params.stateSlug);
    const enabled = Boolean(config?.enabled);
    const title = config && enabled ? `${config.name} — Be Informed` : "Not found — Be Informed";
    return {
      meta: [
        { title },
        {
          name: "description",
          content:
            config && enabled
              ? `What laws ${config.name} is voting on, who is voting, and when — linked to official state sources.`
              : "That page doesn't exist. Be Informed covers every state legislature — pick one from the map.",
        },
        { property: "og:title", content: title },
        {
          property: "og:description",
          content: "Official state legislative data: what's being voted on, who votes, and when.",
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
  const data = Route.useLoaderData();

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

  // Unknown slug, a state we have not turned on yet, or no data folder for it.
  if (!config || !config.enabled || !data) return <NotFound />;

  const { meta } = data;
  const label = sessionLabel(meta);
  const next = meta.session.next;

  // Three honest cases: in session with nothing listed, adjourned, or no session
  // data resolved for this state yet. Never assert a status we have not fetched.
  const quietExplanation = !label
    ? `No upcoming votes have been published for the ${meta.source.name} yet.`
    : meta.session.inSession
      ? `The ${meta.source.name} is in session, but nothing is on its published floor calendars or committee agendas right now.`
      : `The ${meta.source.name} is not currently in session.`;

  return (
    <main className="mx-auto min-h-screen max-w-[820px] px-6 py-16">
      <Link to="/" className="text-[15px] text-inksec transition-colors hover:text-ink">
        ← Be Informed
      </Link>

      <h1 className="mt-6 text-[40px] font-semibold tracking-tight text-ink">{config.name}</h1>
      {label && (
        <p className="mt-2 text-[17px] text-inksec">
          {meta.session.inSession
            ? `${label} — live floor calendars and committee agendas`
            : `${label} — adjourned`}
        </p>
      )}

      {grouped.length === 0 ? (
        <section className="mt-14 border-t border-hairline pt-10">
          <h2 className="text-[21px] font-semibold text-ink">Nothing is scheduled for a vote</h2>
          <p className="mt-3 max-w-prose text-[17px] leading-relaxed text-inksec">
            {quietExplanation}
            {!meta.session.inSession &&
              next &&
              ` The ${next.label} convenes ${formatConvenes(next.convenes)}.`}
          </p>
          <p className="mt-4 text-[15px]">
            <SourceLink href={meta.source.url}>{sourceHost(meta.source.url)}</SourceLink>
          </p>
          {meta.counts.legislators > 0 && (
            <p className="mt-10 text-[15px] text-inksec">
              {meta.counts.legislators} legislators
              {meta.counts.committees > 0 && ` and ${meta.counts.committees} committees`} are on
              file and will be listed against each bill once floor calendars and committee agendas
              reopen.
            </p>
          )}
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
