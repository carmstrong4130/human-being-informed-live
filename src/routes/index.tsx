import { createFileRoute } from "@tanstack/react-router";

import USMap from "@/components/USMap";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "Be Informed — what's being voted on, when, y whom?",
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
          "What's being voted on, when, y whom? Official state legislative data, linked to the source.",
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
    <main className="mx-auto flex min-h-screen max-w-[960px] flex-col items-center px-6 py-20">
      <h1 className="text-[44px] font-semibold tracking-tight text-ink sm:text-[56px]">
        Be Informed
      </h1>
      <p className="mt-3 text-center text-[19px] text-inksec sm:text-[21px]">
        what&apos;s being voted on, when, y whom?
      </p>

      <div className="mt-16 w-full max-w-[900px]">
        <USMap />
      </div>
    </main>
  );
}
