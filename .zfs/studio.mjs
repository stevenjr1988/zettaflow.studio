// Skeleton-owned. Runs `drizzle-kit studio` for apps/api with the port from
// project.json (portBase + 8), on 127.0.0.1 only (drizzle-kit's own default
// is 0.0.0.0:4983, outside the project's port block and open to the LAN).
//
// Extra arguments are passed through: `node ../../.zfs/studio.mjs --verbose`.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const project = JSON.parse(readFileSync(join(root, "project.json"), "utf8"));

const port = String(project.portBase + 8);
// drizzle-kit's "exports" hides bin.cjs from require.resolve, so use the path
// pnpm links into the calling package (apps/api).
const drizzleKitBin = join(
	process.cwd(),
	"node_modules",
	"drizzle-kit",
	"bin.cjs",
);

const child = spawn(
	process.execPath,
	[
		drizzleKitBin,
		"studio",
		"--port",
		port,
		"--host",
		"127.0.0.1",
		...process.argv.slice(2),
	],
	{ stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 0));
