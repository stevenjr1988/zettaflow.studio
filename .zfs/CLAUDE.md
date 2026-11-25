# zfs skeleton

Skeleton-owned: projects made from the skeleton don't edit this file; they
import it from their root `CLAUDE.md` and get updates with
`git pull upstream main`. Project-specific values (name, domains, ports) are in
`project.json` and the project's own `CLAUDE.md`.

A pnpm + Turborepo monorepo in TypeScript. A Hono **api** is the backend.
**www** (Next.js) is one of its clients.

## Rules (all new code)

- **No `try/catch`.** Handle a failed promise with `.catch()` at the place
  it happens, or return the error as a value. Don't wrap code in
  `try { } catch { }` blocks.
- **Arrow functions only.** Write `const doThing = () => { … }`, not
  `function doThing() { … }`. That includes React components, Next route
  handlers (`export const GET = async () => …`) and default exports (declare
  the const, then `export default Name;`). In `.tsx` files a generic arrow
  needs a trailing comma: `const List = <T,>(props: Props<T>) => …`.
- **Accessible: WCAG 2.2 AA at minimum.** Every UI must be fully usable with
  a keyboard and a screen reader. Use semantic HTML before ARIA, label every
  control, keep focus visible, and meet AA contrast. Respect user settings such
  as `prefers-reduced-motion` and text zoom up to 200%.
- **Mobile first, works on mobile and desktop.** Write base styles for small
  screens and add larger layouts with `min-width` breakpoints (Tailwind's
  `sm:`/`md:`/`lg:` prefixes). Nothing may scroll sideways at 320 CSS px.
  Touch targets are at least 24×24 px (aim for 44×44). Support touch, mouse
  and keyboard, and never put essential content or actions behind hover only.
- **i18n-ready.** Projects choose their own i18n library and languages, but
  all code must be ready for them:
  - Never build sentences by joining strings or hard-code plural rules.
    Keep user-facing text separate from logic.
  - Format dates, numbers, currency and lists with `Intl`
    (`DateTimeFormat`, `NumberFormat`, `PluralRules`, `ListFormat`), never by
    hand.
  - Store timestamps as UTC (`timestamptz`) and convert only for display.
    Don't assume a currency, time zone, or name/address format.
  - Use logical CSS (Tailwind `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`, not
    `ml-`/`mr-`/`left-`/`right-`) so right-to-left works. Set `lang` (and
    `dir`) on `<html>`, and leave room for longer translated text.
  - api errors return stable machine-readable codes that clients translate,
    not finished English sentences.

## Architecture

```
browser ──cookie──▶ www (Next.js) ──Bearer──▶ api (Hono) ──▶ Postgres
native clients (mobile / desktop / game engines) ──Bearer──▶ api
```

- **The api is the product.** Every client talks to it the same way, using
  `Authorization: Bearer <token>`. The api never reads or sets cookies.
- **www is just another client.** The browser holds an httpOnly cookie
  (`<name>_session`, name from `project.json`) for www. www forwards requests
  to the api server to server (`http://127.0.0.1:<portBase>`, never through
  Caddy or nginx) and swaps the cookie for a Bearer header.
- **www never touches the database.** Drizzle, the schema and migrations live
  only in `apps/api`.
- **Contracts:** Zod schemas in `@zfs/shared`. The api turns them into an
  OpenAPI 3.1 spec (`/openapi.json`, docs at `/docs`) with `@hono/zod-openapi`.
  - TypeScript clients (www) import `@zfs/shared` directly.
  - Non-TypeScript clients generate their code from `/openapi.json`.

### www routing rule

Every route www serves lives under **`/_api_/`**:

| URL                          | Handled by           | Folder in `apps/www/src/app/`  |
| ---------------------------- | -------------------- | ------------------------------ |
| `/_api_/_www_/*`             | Next itself          | `%5Fapi%5F/%5Fwww%5F/…`        |
| `/_api_/*` (everything else) | forwarded to the api | `%5Fapi%5F/[...path]/route.ts` |

- Folder names use `%5F` for `_`. Next treats a folder starting with `_` as
  private, meaning it never becomes a route. Code and URLs use the real `_`.
- A specific folder always wins over the `[...path]` catch-all. The forwarder
  returns 404 for any unknown `/_www_` path instead of passing it to the api,
  so the api must never use paths starting with `/_www_`.
- Health checks: the api answers `GET /health` (`ApiHealthSchema`, includes
  the database status); www answers `GET /_api_/_www_/health`
  (`WwwHealthSchema`). The home page shows both.

## Layout

```
.zfs/              skeleton-owned: this file, README (setup/updates), zfs:init (init.mjs), next/studio launchers
apps/api/          Hono server, Drizzle (src/db/schema.ts, migrations in drizzle/)
apps/www/          Next.js App Router + Tailwind CSS v4
packages/shared/   @zfs/shared: Zod schemas and types (ships TS source)
packages/gmsi/     @zfs/gmsi: Material Symbols icons (generated)
packages/tsconfig/ @zfs/tsconfig: base / node / next presets
project.json       name, title, devDomain, prodDomain, portBase, database, postgresMajor
dev.ps1            dev stack controller (Windows)
Caddyfile          dev HTTPS reverse proxy (values from project.json)
```

## Stack and pins

TypeScript 7, Next.js 16, React 19, Tailwind 4, Hono 4, Zod 4, Drizzle ORM
with `pg`, PostgreSQL, Biome, tsup (api build), tsx (api dev).

- **Node:** `.node-version`.
- **pnpm:** `packageManager` in the root `package.json`.
- **Postgres major:** `project.json` → `postgresMajor`.
- **Packages must be at least 1 day old.** `pnpm-workspace.yaml` sets
  `minimumReleaseAge: 1440` and `minimumReleaseAgeStrict: true`. Never add
  `minimumReleaseAgeExclude` entries. If an install says the lockfile breaks
  the policy, delete `pnpm-lock.yaml` and run `pnpm install`.
  - Don't use `pnpm clean` while the stack is running: Windows locks files in
    `node_modules`.

## Ports and names

**`project.json` is the only place** name, title, domains, ports and database
are written. Everything reads it: `dev.ps1`, the Caddyfile (`ZFS_*` values that
`dev.ps1` writes to `.tools/caddy.env`, loaded with `caddy run --envfile`),
`.zfs/next.mjs` (www port), the api and www. Never hard-code them elsewhere.
The one copy is the `zfs:project` block in the root `CLAUDE.md`, which
`pnpm zfs:init` regenerates from `project.json`; never edit it by hand.
Never put `;` in a `dev.ps1` pane command: `wt.exe` splits on it.

One block of ten ports from `portBase`, the same in dev and prod:
**api = +0, www = +1, Drizzle Studio = +8 (`.zfs/studio.mjs`), Postgres = +9**;
+2 to +7 are free. The Postgres
database and role are `project.json` → `database` / `name`.

## Skeleton and updates

Projects are cloned from the skeleton and keep it as the `upstream` remote
(setup and update rules: `.zfs/README.md`; `pnpm zfs:init` sets up a fresh
clone). Skeleton-owned, so projects don't edit them: `.zfs/`, `packages/*`
(`@zfs/*`), `dev.ps1`, the Caddyfile. Projects keep the `@zfs/*` scope.

## Environments

|           | Dev (Windows 11)                                       | Prod (Ubuntu VPS behind Cloudflare)                 |
| --------- | ------------------------------------------------------ | --------------------------------------------------- |
| Postgres  | portable binaries in `.tools/pgsql`, data in `.pgdata` | installed on the system (PostgreSQL apt repo)       |
| Proxy     | Caddy (`caddy.exe`, `tls internal`)                    | nginx                                               |
| Processes | `dev.ps1` → Windows Terminal panes                     | pm2                                                 |
| Domains   | `<devDomain>`, `api.<devDomain>` (`project.json`)      | `<prodDomain>`, `api.<prodDomain>` (`project.json`) |

No Docker. Matching versions comes from the pins above. Keep the api
stateless: config only from env, nothing kept in memory or on local disk that
must survive a restart. That way it can scale later without changes.

Git-ignored: `.tools/`, `.pgdata/`, `caddy.exe`, every `.env`,
`CLAUDE.local.md` (personal Claude instructions) and `.private/`.

## Commands (repo root)

```
pnpm zfs:init       set up a fresh clone as a new project
pnpm zfs:reset      same, but start over (drop saved answers, defaults from folder name)
pnpm dev            start the stack: www, api, postgres, caddy panes, db:studio
pnpm stop           stop it (pg_ctl fast shutdown; kills only this repo's node/caddy)
pnpm status         what is listening on the project's ports
pnpm dev:restart
pnpm db:init        one-off: create .pgdata, role/db, write DATABASE_URL to apps/api/.env
pnpm db:generate    drizzle-kit generate (after editing apps/api/src/db/schema.ts)
pnpm db:migrate     drizzle-kit migrate
pnpm db:studio      Drizzle Studio on 127.0.0.1:<portBase + 8>
pnpm typecheck      turbo; www runs `next typegen` first
pnpm lint           biome check .
pnpm format         biome check --write .
pnpm build          turbo; api → apps/api/dist (tsup), www → .next
```

Single app: `pnpm --filter @zfs/api <script>` / `pnpm --filter @zfs/www <script>`.

## Conventions

- **Biome** handles lint and format: tabs, double quotes, semicolons, block
  statements required. Run `pnpm format` before calling work done; `pnpm lint`
  must be clean.
- **Workspace packages ship TypeScript source.** www lists them in
  `transpilePackages` (`next.config.ts`); the api bundles them with tsup
  `noExternal: [/^@zfs\//]`. New `@zfs/*` packages need both.
- **Package scope** is `@zfs/*`.
- **Env:**
  - api: validated with Zod in `apps/api/src/env.ts`. It loads
    `apps/api/.env` when present; real environment variables win.
    `DATABASE_URL` is optional (without it, `/health` reports
    `not-configured`).
  - www: optional `API_URL` in `.env.local`.
- **Add an api endpoint:** define the Zod schema in `@zfs/shared` (give it
  `.meta({ id })` so it appears in the OpenAPI spec), register it with
  `createRoute` + `app.openapi` in the api, and www reaches it at
  `/_api_/<path>`.
- **Next.js:** this version may differ from what you know. Read
  `apps/www/AGENTS.md` and the docs bundled at
  `apps/www/node_modules/next/dist/docs/` before writing Next code. `next dev`
  re-creates `AGENTS.md`; keep it committed.

## Decided, not built yet

- Auth: opaque session tokens stored in Postgres. **No JWT.** Native clients
  send them as Bearer; www stores them in the `<name>_session` cookie.
- Prod: nginx config mirroring the Caddyfile, client IP from
  `CF-Connecting-IP`, pm2 config, deploy script (pull → install → build →
  migrate → `pm2 reload`).
