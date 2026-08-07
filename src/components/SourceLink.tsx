import { cn } from "@/lib/utils";

interface SourceLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  /** Appends the "↗" affordance. On by default. */
  showArrow?: boolean;
}

/**
 * Every fact on this site links back to the government page it came from.
 * This is the one component that does that, so the treatment stays identical
 * everywhere.
 */
export default function SourceLink({
  href,
  children,
  className,
  showArrow = true,
}: SourceLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "underline decoration-hairline underline-offset-4 transition-colors hover:decoration-ink",
        className,
      )}
    >
      {children}
      {showArrow && <span aria-hidden="true"> ↗</span>}
    </a>
  );
}
