// Skeleton-owned. Runs `next dev` / `next start` for apps/www with the port
// from project.json (portBase + 1), so no port is written in package.json.
//
//   dev:   every network interface (reachable from LAN devices)
//   start: 127.0.0.1 only (production sits behind nginx)
//
// Extra arguments are passed through: `node ../../.zfs/next.mjs dev --turbo`.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const project = JSON.parse(readFileSync(join(root, "project.json"), "utf8"));
const [command = "dev", ...rest] = process.argv.slice(2);

const port = String(project.portBase + 1);
const host = command === "start" ? ["--hostname", "127.0.0.1"] : [];
const nextBin = createRequire(join(process.cwd(), "package.json")).resolve(
	"next/dist/bin/next",
);

const child = spawn(
	process.execPath,
	[nextBin, command, "--port", port, ...host, ...rest],
	{ stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 0));
