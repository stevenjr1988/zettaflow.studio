# CLAUDE.md

@.zfs/CLAUDE.md

## This project

zettaflow.studio (`zfs`), built on the zfs skeleton above. This file belongs
to the project; skeleton rules and architecture live in `.zfs/CLAUDE.md`.

- **Ports:** api 30000, www 30001, Postgres 30009 (`portBase` 30000).
- **Database and role:** `zfs`. Session cookie: `zfs_session`.
- **Domains:** dev `zettaflow.studio.local` / `api.zettaflow.studio.local`;
  prod `zettaflow.studio` / `api.zettaflow.studio`.
