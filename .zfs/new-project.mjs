// Skeleton-owned. `pnpm zfs:new`: turn a fresh clone of the skeleton into
// your own project. Safe to run again; it shows the current values as defaults.
//
// It asks for name, title, dev domain, port block and database, writes
// project.json, sets up git remotes (skeleton as `upstream`), checks the hosts
// file and the two dev binaries (caddy.exe, portable Postgres), then offers
// `pnpm install` and `pnpm db:init`. It never renames or edits @zfs packages.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const root = resolve(import.meta.dirname, "..");
const projectFile = join(root, "project.json");
const current = JSON.parse(readFileSync(projectFile, "utf8"));
const rl = createInterface({
	input: process.stdin,
	crlfDelay: Number.POSITIVE_INFINITY,
});
// One queue for every answer, so it works both typed and piped
// (`printf 'a\nb\n' | pnpm zfs:new`). When input runs out, defaults apply.
const lines = rl[Symbol.asyncIterator]();
let inputEnded = false;

const PG_BINARIES_URL =
	"https://www.enterprisedb.com/download-postgresql-binaries";
const CADDY_URL = "https://caddyserver.com/download";
const HOSTS_FILE = "C:\\Windows\\System32\\drivers\\etc\\hosts";

const say = (text = "") => console.log(text);
const heading = (text) => say(`\n== ${text}`);

const prompt = async (text) => {
	process.stdout.write(text);
	const next = inputEnded ? { done: true } : await lines.next();
	inputEnded = inputEnded || Boolean(next.done);
	const answer = next.done ? "" : next.value.trim();
	if (!process.stdin.isTTY) {
		// Piped input isn't echoed by the terminal; show it so the log reads well.
		process.stdout.write(`${answer}\n`);
	}
	return answer;
};

const ask = async (question, fallback, isValid = () => true, hint = "") => {
	for (;;) {
		const answer =
			(await prompt(`${question} [${fallback}]: `)) || String(fallback);
		if (isValid(answer)) {
			return answer;
		}
		say(`  ${hint}`);
		if (inputEnded) {
			say("  no more input - stopping.");
			process.exit(1);
		}
	}
};

const confirm = async (question, fallback = true) => {
	const answer = (
		await prompt(`${question} [${fallback ? "Y/n" : "y/N"}]: `)
	).toLowerCase();
	return answer ? answer.startsWith("y") : fallback;
};

const git = (...args) =>
	spawnSync("git", args, { cwd: root, encoding: "utf8" });

const run = (command, args) =>
	spawnSync(command, args, {
		cwd: root,
		stdio: "inherit",
		shell: process.platform === "win32",
	}).status === 0;

const slug = (text) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/^(\d)/, "p$1") || "app";

// --- 1. Identity -----------------------------------------------------------

heading("Project");
say(
	"Values are written to project.json, the only file a project edits for this.",
);

const folder = basename(root);
const isSkeletonDefaults = current.name === "zfs";

const name = await ask(
	"Short name (lowercase; Postgres role, terminal titles, cookie prefix)",
	isSkeletonDefaults ? slug(folder) : current.name,
	(v) => /^[a-z][a-z0-9_]{0,30}$/.test(v),
	"lowercase letters, digits and _, starting with a letter, max 31 chars",
);
const title = await ask(
	"Title (page title, API docs)",
	isSkeletonDefaults ? folder : current.title,
);
const domain = await ask(
	"Dev domain (served by Caddy; api.<domain> for the api)",
	isSkeletonDefaults
		? `${slug(folder).replaceAll("_", "-")}.local`
		: current.domain,
	(v) =>
		/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v),
	"a hostname like myapp.local",
);
const portBase = Number(
	await ask(
		"Port block start (api = +0, www = +1, Postgres = +9; must not overlap another project)",
		isSkeletonDefaults ? current.portBase + 10 : current.portBase,
		(v) =>
			/^\d+$/.test(v) &&
			Number(v) % 10 === 0 &&
			Number(v) >= 1024 &&
			Number(v) <= 65520,
		"a multiple of 10 between 1024 and 65520",
	),
);
const database = await ask(
	"Postgres database name",
	isSkeletonDefaults ? name : current.database,
	(v) => /^[a-z][a-z0-9_]{0,62}$/.test(v),
	"lowercase letters, digits and _, starting with a letter",
);

const project = { ...current, name, title, domain, portBase, database };
writeFileSync(projectFile, `${JSON.stringify(project, null, "\t")}\n`);
say(
	`  wrote project.json (api ${portBase}, www ${portBase + 1}, postgres ${portBase + 9})`,
);

// --- 2. Git remotes --------------------------------------------------------

heading("Git");
const remotes = git("remote").stdout.split(/\s+/).filter(Boolean);
if (remotes.includes("origin") && !remotes.includes("upstream")) {
	const originUrl = git("remote", "get-url", "origin").stdout.trim();
	say(`  origin is ${originUrl}`);
	if (
		await confirm(
			"  Is that the skeleton? Rename it to 'upstream' (for pulling skeleton updates)?",
		)
	) {
		git("remote", "rename", "origin", "upstream");
		say("  origin -> upstream");
	}
}
if (!git("remote").stdout.split(/\s+/).includes("origin")) {
	const url = (
		await prompt("  Your own repo URL for 'origin' (empty to skip): ")
	).trim();
	if (url) {
		git("remote", "add", "origin", url);
		say(`  origin = ${url}`);
	}
}
say(
	`  remotes: ${git("remote", "-v").stdout.trim().replaceAll("\n", "\n           ") || "(none)"}`,
);

// --- 3. Hosts file ---------------------------------------------------------

heading("Hosts file");
const hosts = existsSync(HOSTS_FILE) ? readFileSync(HOSTS_FILE, "utf8") : "";
const hasHost = (host) =>
	hosts.split(/\r?\n/).some((line) => {
		const parts = line.replace(/#.*/, "").trim().split(/\s+/);
		return parts.length > 1 && parts.slice(1).includes(host);
	});
const missingHosts = [domain, `api.${domain}`].filter((h) => !hasHost(h));
if (missingHosts.length === 0) {
	say("  ok");
} else {
	say(`  Add these lines to ${HOSTS_FILE} (needs an admin editor):`);
	for (const h of missingHosts) {
		say(`    127.0.0.1  ${h}`);
	}
}

// --- 4. Dev binaries (git-ignored, not in the repo) --------------------------

heading("Dev binaries");
const caddyPath = join(root, "caddy.exe");
const pgPath = join(root, ".tools", "pgsql");
const hasCaddy = () => existsSync(caddyPath);
const hasPg = () => existsSync(join(pgPath, "bin", "postgres.exe"));

if (!hasCaddy() || !hasPg()) {
	say(
		`  missing: ${[!hasCaddy() && "caddy.exe", !hasPg() && ".tools/pgsql"].filter(Boolean).join(", ")}`,
	);
	const from = (
		await prompt(
			"  Copy them from another project folder? Path (empty to skip): ",
		)
	).trim();
	if (from) {
		const source = resolve(from);
		if (!hasCaddy() && existsSync(join(source, "caddy.exe"))) {
			cpSync(join(source, "caddy.exe"), caddyPath);
			say("  copied caddy.exe");
		}
		if (
			!hasPg() &&
			existsSync(join(source, ".tools", "pgsql", "bin", "postgres.exe"))
		) {
			say("  copying .tools/pgsql (a few hundred MB)...");
			cpSync(join(source, ".tools", "pgsql"), pgPath, { recursive: true });
			say("  copied .tools/pgsql");
		}
	}
}
say(
	`  caddy.exe     ${hasCaddy() ? "ok" : `missing - download Windows amd64 from ${CADDY_URL}, save as caddy.exe in the repo root`}`,
);
say(
	`  .tools/pgsql  ${hasPg() ? "ok" : `missing - PostgreSQL ${project.postgresMajor} Windows x86-64 zip from ${PG_BINARIES_URL}; copy bin, lib, share into .tools/pgsql`}`,
);

// --- 5. Install and database -------------------------------------------------

heading("Install");
if (await confirm("  Run pnpm install now?")) {
	run("pnpm", ["install"]);
}

if (existsSync(join(root, ".pgdata"))) {
	say("  .pgdata already exists - skipping db:init (delete it to start over).");
} else if (
	hasPg() &&
	(await confirm("  Create the local database now (pnpm db:init)?"))
) {
	run("pnpm", ["db:init"]);
}

heading("Done");
say("  pnpm dev       start everything");
say(`  https://${domain}      www`);
say(`  https://api.${domain}  api`);
say("  git pull upstream main   later, to get skeleton updates");
rl.close();
