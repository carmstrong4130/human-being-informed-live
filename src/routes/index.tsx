import { createFileRoute } from "@tanstack/react-router";

import USMap from "@/components/USMap";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "Be Informed — what's being voted on where you live?",
      },
      {
        name: "description",
        content:
          "A fact-only look at what laws are being voted on at the state level, who is voting on them, and when — every item linked to its official government source.",
      },
      { property: "og:title", content: "Be Informed" },
      {
        property: "og:description",
        content:
          "What's being voted on where you live? Official state legislative data, linked to the source.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://www.humanbeinginformed.com" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1100px] flex-col items-center justify-center px-6 py-16 selection:bg-stategreen/30">
      <header className="mb-10 text-center md:mb-14">
        <span className="block font-sans text-xs font-bold uppercase tracking-[0.3em] text-inksec/80 md:text-sm">
          Be Informed
        </span>
        <h1 className="font-display mt-4 max-w-4xl text-[34px] font-extrabold leading-[1.1] tracking-tight text-ink sm:text-[48px] md:text-[58px] lg:text-[68px]">
          What&apos;s being voted on{" "}
          <span className="text-stategreen">where you live?</span>
        </h1>
      </header>

      <div className="relative w-full overflow-hidden rounded-3xl border border-white/5 bg-card/40 p-6 shadow-2xl sm:p-10 md:p-14">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(47,176,92,0.06)_0%,transparent_70%)]" />
        <div className="relative">
          <USMap />
        </div>

        <div className="absolute bottom-4 right-5 flex items-center gap-2 sm:bottom-6 sm:right-8">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-stategreen opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-stategreen" />
          </span>
          <span className="font-sans text-[11px] font-medium tracking-wide text-inksec sm:text-xs">
            Select a highlighted state to track legislation
          </span>
        </div>
      </div>
    </main>
  );
}
