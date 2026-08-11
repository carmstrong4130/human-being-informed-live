import { Link } from "@tanstack/react-router";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[640px] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[32px] font-semibold tracking-tight text-ink">Nothing here yet</h1>
      <p className="mt-3 text-[17px] text-inksec">
        That page doesn&apos;t exist. Every state is on the map.
      </p>
      <Link
        to="/"
        className="mt-8 text-[17px] text-stategreen underline decoration-transparent underline-offset-4 transition-colors hover:decoration-stategreen"
      >
        Back to the map
      </Link>
    </main>
  );
}
