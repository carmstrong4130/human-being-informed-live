# Be Informed — humanbeinginformed.com

What laws are being voted on where you live, who votes on them, and when. Every
item links to the official government source. Facts only: no commentary, no
endorsement, no analysis.

Coverage is all 50 states plus the District of Columbia. Pick a state from the
map on the homepage, or go straight to `/{state-slug}` (for example
`/utah`, `/new-hampshire`, `/district-of-columbia`).

## How the data works

Nothing is fetched at runtime. Each jurisdiction has a committed JSON snapshot
under `src/data/<slug>/`, scheduled jobs refresh those snapshots, and the commit
rebuilds the site. Pages are therefore static and never show a loading state.

Five files per jurisdiction, typed by `src/lib/types.ts`:

| File               | Contents                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `meta.json`        | session label and in/out-of-session status, counts, source attribution, last-updated timestamps |
| `legislators.json` | name, chamber, party, district, official bio link, portrait                                     |
| `committees.json`  | name, chamber, member ids, official page                                                        |
| `bills.json`       | the bills referenced by upcoming events (a cache, so repeat runs are cheap)                     |
| `vote-events.json` | one entry per upcoming bill vote: when, where, which body, who votes, source link               |

`src/data/index.ts` discovers these with a non-eager `import.meta.glob`, so Vite
emits one chunk per jurisdiction and a visitor only ever downloads the state they
are looking at. Adding a jurisdiction means shipping a data folder and setting
`enabled: true` in `src/config/states.ts` — nothing else in the app is
state-specific.

### Two sources, two fetchers

**Utah — `scripts/fetch-utah.ts`.** The state's own API at `glen.le.utah.gov` and
`le.utah.gov`. Richer than the national pipeline: it gets floor reading calendars
as well as committee agendas, sponsor names and last actions on bills, and it
mirrors official portraits into `public/legislators/`. The Legislature publishes
rate guidance at <https://le.utah.gov/data/developer.htm>; the schedules below
stay inside it.

**Everywhere else — `scripts/fetch-states.ts`.** Two upstreams, chosen so the
metered one is used as little as possible:

- Rosters come from the [`openstates/people`](https://github.com/openstates/people)
  git repository, read as a single 5 MB tarball. Public domain, no key, no quota.
  Portraits are hotlinked to the photo each state publishes rather than mirrored,
  because committing 7,000+ images would bloat the repository; `Portrait` falls
  back to initials if an image fails to load.
- Sessions, events and bill titles come from the
  [OpenStates (Plural) v3 API](https://docs.openstates.org/api-v3/). **The free
  tier is 10 requests/minute and 250/day**, which is the binding constraint on
  the whole pipeline. The script counts its own requests, spaces them 7 seconds
  apart, and hard-stops at 230 — logging exactly which jurisdictions it skipped,
  so a partial run can never be mistaken for a complete one. It starts at a
  different jurisdiction each day so the same states are not always the ones cut.

`scripts/jurisdictions.ts` is generated (by `scripts/build-jurisdictions.ts`)
from OpenStates' canonical metadata, and holds each jurisdiction's OCD id,
legislature name and official homepage.

Two things worth knowing when reading the output:

- OpenStates has event scrapers for every state, but real coverage is thin in
  some and floor reading calendars are largely absent, so nearly every non-Utah
  vote event is a committee hearing.
- Most legislatures are adjourned for much of the year. A page reading "Nothing
  is scheduled for a vote" is usually correct, not broken.

### Refresh schedules

| Workflow                         | Schedule         | Needs                               |
| -------------------------------- | ---------------- | ----------------------------------- |
| `refresh-utah-roster.yml`        | daily            | `UTAH_LEG_TOKEN` (optional)         |
| `refresh-utah-calendars.yml`     | every 3 hours    | `UTAH_LEG_TOKEN` (optional)         |
| `refresh-national-roster.yml`    | weekly (Mondays) | nothing                             |
| `refresh-national-calendars.yml` | daily            | `OPENSTATES_API_KEY` (**required**) |

All four share one `concurrency` group because they all commit to `main`, and
none of them install dependencies — the fetchers import nothing outside Node's
standard library, and Node runs the TypeScript directly by stripping types.

The Utah roster workflow also carries a keepalive, because GitHub disables
scheduled workflows after 60 days of repository inactivity and this data can sit
unchanged for months between sessions.

### Repository secrets

Set these under **Settings → Secrets and variables → Actions**.

- **`OPENSTATES_API_KEY`** — required for `refresh-national-calendars`. Free, no
  card, from <https://open.pluralpolicy.com/accounts/profile/>. Without it that
  workflow fails loudly with instructions rather than writing empty data.
- **`UTAH_LEG_TOKEN`** — optional. The Utah fetcher falls back to the
  Legislature's public demo token (`5678`), which works but is shared; a real
  token should be requested from the Legislature by phone.

## Deploying data updates

**This site is served by Lovable hosting, which publishes a manual snapshot.**
Pushes to `main` — including every scheduled data commit above — sync into the
Lovable _editor_, but the live site at humanbeinginformed.com does not change
until someone opens Lovable and clicks **Publish → Publish changes**
([docs](https://docs.lovable.dev/features/publish)).

So the data refreshes are only as fresh as the last manual publish. Two ways to
close that gap:

1. **Recommended: point Vercel (or Netlify) at this repository.** Both deploy on
   push, so a data commit goes live by itself, and Lovable keeps working as an
   editor through its GitHub sync. This is the only option that makes the
   schedules above actually meaningful.
2. Lovable's experimental MCP `deploy_project` tool, if you would rather stay
   entirely inside Lovable.

No hosting change has been made — this is a decision for the project owner.

## Local development

Requires Node 24 or newer (the fetchers rely on Node running TypeScript
directly). The repository is bun-locked; `bun install` is preferred, and if you
install with npm instead, do not commit `package-lock.json` (it is gitignored).

```sh
bun install
bun run dev
```

### Scripts

```sh
bun run build                  # production build
bun run typecheck              # app and scripts
bun run lint

bun run data:utah:roster       # Utah legislators, committees, portraits
bun run data:utah:calendars    # Utah bills, floor calendars, committee agendas
bun run data:states:roster     # all other jurisdictions' rosters (no API quota)
bun run data:states:calendars  # all other jurisdictions' sessions and events (needs the key)
bun run data:sitemap           # regenerate public/sitemap.xml from states.ts
```

`fetch-states.ts` takes `--states=ca,ne,dc` to work on a subset, which is the
cheap way to test a change against the API.

## Built with Lovable

Continue developing this project in the
[Lovable editor](https://lovable.dev/projects/ca3984ff-4dbe-4ef9-8549-b746e5df0a43).
Commits pushed to `main` sync back into Lovable, so keep the branch building, and
avoid rewriting published history — force-pushing or rebasing pushed commits
rewrites history on Lovable's side too.
