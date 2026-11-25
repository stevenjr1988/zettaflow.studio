# zfs skeleton

A starting point for new projects: a pnpm + Turborepo monorepo with a Hono
**api** (the backend every client talks to), a Next.js **www** (one of those
clients), PostgreSQL through Drizzle, shared Zod contracts and a one-command
Windows dev stack.

This folder (`.zfs/`) belongs to the skeleton. Projects made from it should
not edit anything here; see [Updating from the skeleton](#updating-from-the-skeleton).

## Requirements (Windows 11)

- **Node** — the version in `.node-version`
- **pnpm** — any recent version; it switches itself to the version pinned in
  `package.json` (`packageManager`)
- **Windows Terminal** (`wt.exe`) — `pnpm dev` opens the stack in its panes
- **git**
- Two dev binaries that are **not in the repo** (git-ignored, too big):
  - `caddy.exe` in the repo root — https://caddyserver.com/download (Windows amd64)
  - PostgreSQL portable binaries in `.tools/pgsql` — the zip from
    https://www.enterprisedb.com/download-postgresql-binaries for the major
    version in `project.json` (`postgresMajor`); copy its `bin`, `lib` and
    `share` folders into `.tools/pgsql`

## Start a new project

### The quick way: `pnpm zfs:init`

```
git clone <skeleton-url> my-app
cd my-app
pnpm zfs:init
```

It asks a few questions and does the rest:

0. **Tools**: checks Node against `.node-version`, pnpm against
   `packageManager`, and that git and Windows Terminal are installed. A wrong
   Node major or a missing pnpm/git stops it unless you say continue.
1. **Project values**: title (`Zetta Flow Studio`), short name (an
   abbreviation such as `zfs`), production domain, dev domain (default
   `<name>.localhost`),
   port block and database name. They are written to `project.json`, to the
   generated block in the root `CLAUDE.md` and to the `README.md` title, so
   Claude sees this project's values, not the skeleton's.
2. **Git remotes**: renames the skeleton remote from `origin` to `upstream`
   (so you can pull skeleton updates later) and adds your own repo as
   `origin`.
3. **Dev binaries**: checks for `caddy.exe` and `.tools/pgsql`. Give it any
   folder (another project, Downloads, an unzipped EDB zip) and it searches a
   few levels deep for them; it asks again for whatever is still missing. It
   checks the Postgres major version, and can download `caddy.exe` for you.
   It also writes `.tools/caddy.env`.
4. **Hosts file**: not needed for `*.localhost` domains. For any other domain
   it checks for `<devDomain>` and `api.<devDomain>` and prints the lines to add
   (editing the hosts file needs admin rights, so you do that part).
5. **Install**: offers `pnpm install` and `pnpm db:init` (creates the local
   database and writes `DATABASE_URL` to `apps/api/.env`).

Then `pnpm dev`. Running `pnpm zfs:init` again is safe; it shows your current
values as defaults.

### The manual way

1. `git clone <skeleton-url> my-app` and `cd my-app`
2. Remotes:

   ```
   git remote rename origin upstream
   git remote add origin <your-repo-url>
   ```
3. Edit **`project.json`** — the only file you change for this:

   | Field           | Meaning                                                                                                                |
   | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
   | `name`          | short lowercase name: Postgres role, terminal pane titles, session cookie prefix                                       |
   | `title`         | human name: page title, API docs title                                                                                 |
   | `devDomain`     | dev domain served by Caddy (`https://<devDomain>`, `https://api.<devDomain>`)                                          |
   | `prodDomain`    | real public domain (`https://<prodDomain>`, `https://api.<prodDomain>`), served by nginx in prod                       |
   | `portBase`      | start of a block of 10 ports: api = +0, www = +1, Drizzle Studio = +8, Postgres = +9. Must not overlap another project |
   | `database`      | Postgres database name                                                                                                 |
   | `postgresMajor` | Postgres major version the binaries in `.tools/pgsql` must match                                                       |

4. Add to `C:\Windows\System32\drivers\etc\hosts` (as admin):

   ```
   127.0.0.1  <devDomain>
   127.0.0.1  api.<devDomain>
   ```
5. Put `caddy.exe` in the repo root and the Postgres binaries in
   `.tools/pgsql` (see Requirements).
6. `pnpm install`
7. `pnpm db:init` — once; creates `.pgdata`, the role and database, and writes
   `DATABASE_URL` to `apps/api/.env`
8. `pnpm dev` — opens www, api, Postgres and Caddy in Windows Terminal panes.
   `pnpm stop` stops them, `pnpm status` shows what's running.

## How `project.json` drives everything

Nothing else in the repo contains your domain, ports or names:

| Reads `project.json`             | Uses                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `dev.ps1` (`pnpm dev`, …)        | ports, pane titles, database role and name, Postgres version check                                                                      |
| `Caddyfile`                      | domain and ports, written by `dev.ps1` to `.tools/caddy.env` (`ZFS_DOMAIN`, `ZFS_API_PORT`, `ZFS_WWW_PORT`) and loaded with `--envfile` |
| `.zfs/next.mjs`                  | www port (`portBase + 1`) for `next dev` / `next start`                                                                                 |
| `.zfs/studio.mjs`                | Drizzle Studio port (`portBase + 8`) for `pnpm db:studio`                                                                               |
| api (`src/env.ts`, `src/app.ts`) | default port, API docs title                                                                                                            |
| www                              | api address for the `/_api_/` forwarder, session cookie name, page title, allowed dev host                                              |

So `pnpm zfs:init` and the manual steps both come down to: edit
`project.json`, then supply what git can't (hosts file, binaries, database).

## Updating from the skeleton

Your project keeps the skeleton as the `upstream` remote:

```
git pull upstream main
```

Git merges file by file. It only conflicts when **both** the skeleton and
your project changed the same lines of the same file. To keep updates
conflict-free:

- **Don't edit skeleton-owned files** in your project: anything in `.zfs/`,
  the `@zfs/*` packages in `packages/`, `dev.ps1`, the `Caddyfile`.
- **Do edit project files freely**: `project.json`, your pages and routes,
  your own packages, your `README.md`.
- **Keep the `@zfs/*` package scope.** Renaming it would touch dozens of
  files and make every future update conflict.

## Local-only files

Never committed (`.gitignore`):

- `.env` files — real secrets and local values; `.env.example` files show
  what can be set
- `.tools/`, `.pgdata/`, `caddy.exe` — dev binaries and the local database
- `CLAUDE.local.md` — personal instructions for Claude Code, loaded
  automatically next to `CLAUDE.md`
- `.private/` — your own notes and drafts
