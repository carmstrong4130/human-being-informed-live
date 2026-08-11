import SourceLink from "@/components/SourceLink";
import type { StateMeta } from "@/lib/types";

function formatUpdated(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Every source is credited by name and linked. le.utah.gov asks for attribution
 * explicitly; the credit is unconditional here for all states regardless of how
 * the site is used.
 */
export default function SiteFooter({ meta }: { meta?: StateMeta }) {
  const updated = meta ? formatUpdated(meta.lastUpdated) : null;

  return (
    <footer className="mt-20 border-t border-hairline pt-8 text-[13px] text-inksec">
      {meta && (
        <p>
          Data from the <SourceLink href={meta.source.url}>{meta.source.name}</SourceLink>
        </p>
      )}
      {updated && <p className="mt-1">Data last updated {updated}</p>}
      <p className="mt-4">
        Be Informed publishes official records only. Nothing here is commentary, endorsement, or
        analysis.
      </p>
    </footer>
  );
}
