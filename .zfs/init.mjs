// Skeleton-owned. `pnpm zfs:init`: set up this clone of the zfs skeleton as
// your own project. Safe to run again; it shows the current values as defaults.
//
// It asks for title, short name, prod and dev domains, port block and database, writes
// project.json (and the project block in CLAUDE.md), sets up git remotes
// (skeleton as `upstream`, your repo as `origin`), finds or downloads the dev
// binaries (caddy.exe, portable Postgres), writes .tools/caddy.env, checks the
// hosts file, then offers `pnpm install` and `pnpm db:init`.
// It never renames or edits @zfs packages.
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const root = resolve(import.meta.dirname, "..");
const projectFile = join(root, "project.json");
const current = JSON.parse(readFileSync(projectFile, "utf8"));
const rl = createInterface({
	input: process.stdin,
	crlfDelay: Number.POSITIVE_INFINITY,
});
// One queue for every answer, so it works both typed and piped
// (`printf 'a\nb\n' | pnpm zfs:init`). When input runs out, defaults apply.
const lines = rl[Symbol.asyncIterator]();
let inputEnded = false;

const PG_BINARIES_URL =
	"https://www.enterprisedb.com/download-postgresql-binaries";
const CADDY_URL = "https://caddyserver.com/download";
const CADDY_DOWNLOAD_URL =
	"https://caddyserver.com/api/download?os=windows&arch=amd64";
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

// Through a shell, so Windows finds pnpm.cmd. Only fixed strings from this
// file go in here, so joining them into one command line is safe (and avoids
// Node's DEP0190 warning about passing args with `shell`).
const shellSync = (command, args, options) =>
	spawnSync([command, ...args].join(" "), {
		cwd: root,
		shell: true,
		...options,
	});

const run = (command, args) =>
	shellSync(command, args, { stdio: "inherit" }).status === 0;

const slug = (text) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/^(\d)/, "p$1") || "app";

// "Zetta Flow Studio" -> "zfs", "ZettaFlowStudio" -> "zfs", "zettaflow" -> "zettaflow".
const abbreviate = (text) => {
	const words = text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);
	return words.length > 1 ? slug(words.map((w) => w[0]).join("")) : slug(text);
};

// --- 0. Tools ----------------------------------------------------------------

heading("Tools");
const version = (command, args = ["--version"]) => {
	const result = shellSync(command, args, { encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : null;
};
const major = (v) => v?.match(/\d+/)?.[0];

const wantNode = readFileSync(join(root, ".node-version"), "utf8").trim();
const haveNode = process.versions.node;
const wantPnpm = JSON.parse(
	readFileSync(join(root, "package.json"), "utf8"),
).packageManager?.replace(/^pnpm@/, "");
const havePnpm = version("pnpm");
const haveGit = version("git");
const haveWt =
	process.platform !== "win32" || version("where", ["wt.exe"]) !== null;

const tools = [
	{
		label: "node",
		ok: haveNode === wantNode,
		fatal: major(haveNode) !== major(wantNode),
		text:
			haveNode === wantNode
				? haveNode
				: `${haveNode}, .node-version pins ${wantNode} (prod runs the pinned one)`,
	},
	{
		label: "pnpm",
		ok: havePnpm === wantPnpm,
		fatal: !havePnpm,
		text: !havePnpm
			? "not found - install it: npm install -g pnpm"
			: havePnpm === wantPnpm
				? havePnpm
				: `${havePnpm}, package.json pins ${wantPnpm} (pnpm normally switches itself)`,
	},
	{
		label: "git",
		ok: Boolean(haveGit),
		fatal: !haveGit,
		text: haveGit
			? (haveGit.match(/\d+(?:\.\d+)*/)?.[0] ?? haveGit)
			: "not found",
	},
	{
		label: "wt.exe",
		ok: haveWt,
		fatal: false,
		text: haveWt
			? "ok"
			: "not found - `pnpm dev` needs Windows Terminal (Microsoft Store)",
	},
];
for (const t of tools) {
	say(`  ${t.label.padEnd(7)} ${t.ok ? "" : "! "}${t.text}`);
}
if (
	tools.some((t) => t.fatal) &&
	!(await confirm(
		"  Some of these won't work as they are. Continue anyway?",
		false,
	))
) {
	say("  stopped - fix the tools above, then run `pnpm zfs:init` again.");
	rl.close();
	process.exit(1);
}

// --- 1. Identity -----------------------------------------------------------

heading("Project");
say(
	"Values are written to project.json, the only file a project edits for this.",
);

const folder = basename(root);
const isSkeletonDefaults = current.name === "zfs";

const title = await ask(
	"Title - the full human name, shown as page title and API docs title\n  (e.g. Zetta Flow Studio)",
	isSkeletonDefaults ? folder : current.title,
);
const name = await ask(
	"Short name - an abbreviation used for the Postgres role, terminal pane titles\n  and the session cookie prefix (e.g. zfs for Zetta Flow Studio)",
	isSkeletonDefaults ? abbreviate(title) : current.name,
	(v) => /^[a-z][a-z0-9_]{0,30}$/.test(v),
	"lowercase letters, digits and _, starting with a letter, max 31 chars",
);
const isHostname = (v) =>
	/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v);
const hyphenName = name.replaceAll("_", "-");
const prodDomain = await ask(
	"Production domain - the real public domain (api.<domain> for the api)",
	current.prodDomain ||
		(isHostname(folder.toLowerCase())
			? folder.toLowerCase()
			: `${hyphenName}.com`),
	isHostname,
	"a hostname like example.com",
);
// `domain` is the key used before devDomain/prodDomain existed.
const devDomain = await ask(
	"Dev domain - local hostname Caddy serves www on (api.<domain> for the api).\n  Anything works; *.localhost needs no hosts-file entry for browsers",
	isSkeletonDefaults
		? `${hyphenName}.localhost`
		: (current.devDomain ?? current.domain),
	(v) => isHostname(v) && v !== prodDomain,
	"a hostname with at least one dot, like myapp.localhost - not the production domain",
);
const portBase = Number(
	await ask(
		"Port block start - a multiple of 10, must not overlap another project\n  (api = +0, www = +1, Drizzle Studio = +8, Postgres = +9)",
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

const { domain: _oldDomain, ...rest } = current;
const values = { name, title, devDomain, prodDomain, portBase, database };
// These keys first, in this order, then any others (postgresMajor, ...).
const project = { ...values, ...rest, ...values };
writeFileSync(projectFile, `${JSON.stringify(project, null, "\t")}\n`);
say(
	`  wrote project.json (api ${portBase}, www ${portBase + 1}, studio ${portBase + 8}, postgres ${portBase + 9})`,
);

// The root CLAUDE.md holds a generated block with these values, so Claude in
// a new project never sees the skeleton's (or a previous project's) values.
const BLOCK_START =
	"<!-- zfs:project - written by `pnpm zfs:init` from project.json; don't edit by hand -->";
const BLOCK_END = "<!-- /zfs:project -->";
const projectBlock = [
	BLOCK_START,
	`- **Project:** ${title} (\`${name}\`)`,
	`- **Ports:** api ${portBase}, www ${portBase + 1}, Drizzle Studio ${portBase + 8}, Postgres ${portBase + 9} (\`portBase\` ${portBase}).`,
	`- **Database:** \`${database}\`, role \`${name}\`. Session cookie: \`${name}_session\`.`,
	`- **Dev domains:** \`${devDomain}\` / \`api.${devDomain}\`.`,
	`- **Prod domains:** \`${prodDomain}\` / \`api.${prodDomain}\`.`,
	BLOCK_END,
].join("\n");

const claudeFile = join(root, "CLAUDE.md");
const claudeText = existsSync(claudeFile)
	? readFileSync(claudeFile, "utf8")
	: "# CLAUDE.md\n\n@.zfs/CLAUDE.md\n\n## This project\n";
const blockStart = claudeText.indexOf("<!-- zfs:project");
const blockEnd = claudeText.indexOf(BLOCK_END);
const newClaudeText =
	blockStart >= 0 && blockEnd > blockStart
		? claudeText.slice(0, blockStart) +
			projectBlock +
			claudeText.slice(blockEnd + BLOCK_END.length)
		: `${claudeText.trimEnd()}\n\n${projectBlock}\n`;
writeFileSync(claudeFile, newClaudeText);
say("  wrote the project block in CLAUDE.md");

// README.md: retitle it while it is still the skeleton's placeholder README.
const readmeFile = join(root, "README.md");
if (existsSync(readmeFile)) {
	const readme = readFileSync(readmeFile, "utf8");
	const isPlaceholder = readme.includes("replace it with your own.");
	const headingEnd = readme.indexOf("\n");
	if (
		isPlaceholder &&
		readme.startsWith("# ") &&
		readme.slice(2, headingEnd) !== title
	) {
		writeFileSync(readmeFile, `# ${title}${readme.slice(headingEnd)}`);
		say("  retitled README.md");
	}
}

// --- 2. Git remotes --------------------------------------------------------

heading("Git");
say(
	"  Two remotes: 'upstream' = the zfs skeleton you cloned (pull its updates",
);
say(
	"  later with `git pull upstream main`), 'origin' = your project's own repo.",
);
const remotes = git("remote").stdout.split(/\s+/).filter(Boolean);
if (remotes.includes("origin") && !remotes.includes("upstream")) {
	const originUrl = git("remote", "get-url", "origin").stdout.trim();
	say(`  'origin' currently points to ${originUrl}`);
	if (
		await confirm(
			"  Is that the zfs skeleton you cloned from? Rename it to 'upstream'?",
			isSkeletonDefaults,
		)
	) {
		git("remote", "rename", "origin", "upstream");
		say("  origin -> upstream");
	}
}
if (!git("remote").stdout.split(/\s+/).includes("origin")) {
	const url = (
		await prompt(
			"  URL of this project's own git repo, to push your work to\n  (e.g. https://github.com/you/my-app.git; empty to add it later): ",
		)
	).trim();
	if (url) {
		git("remote", "add", "origin", url);
		say(`  origin = ${url}`);
	}
}
say(
	`  remotes: ${git("remote", "-v").stdout.trim().replaceAll("\n", "\n           ") || "(none)"}`,
);

// --- 3. Dev binaries (git-ignored, not in the repo) --------------------------

heading("Dev binaries");
const toolsDir = join(root, ".tools");
const caddyPath = join(root, "caddy.exe");
const pgPath = join(toolsDir, "pgsql");
const hasCaddy = () => existsSync(caddyPath);
const hasPg = () => existsSync(join(pgPath, "bin", "postgres.exe"));
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();
const isPgDir = (path) => existsSync(join(path, "bin", "postgres.exe"));

// Folders below `start`, breadth first, a few levels deep. Skips the heavy
// ones so pointing at a whole drive or Downloads stays quick.
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".pgdata"]);
// Unreadable folders (no permission) count as empty.
const subdirs = (dir) =>
	readdir(dir, { withFileTypes: true })
		.then((entries) =>
			entries
				.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
				.map((e) => join(dir, e.name)),
		)
		.catch(() => []);
const walk = async (start, depth = 3) => {
	const found = [start];
	for (let i = 0, level = [start]; i < depth; i++) {
		level = (await Promise.all(level.map(subdirs))).flat();
		found.push(...level);
	}
	return found;
};

// Accepts a project folder, the folder holding caddy.exe, caddy.exe itself,
// a pgsql folder, or an unzipped EDB download - anywhere on disk.
const findTools = async (input) => {
	const path = resolve(input.replace(/^"|"$/g, ""));
	if (!existsSync(path)) {
		return { caddy: null, pg: null };
	}
	if (!isDir(path)) {
		return {
			caddy: basename(path).toLowerCase() === "caddy.exe" ? path : null,
			pg:
				basename(path).toLowerCase() === "postgres.exe"
					? dirname(dirname(path))
					: null,
		};
	}
	const dirs = await walk(path);
	const caddyDir = dirs.find((d) => existsSync(join(d, "caddy.exe")));
	return {
		caddy: caddyDir ? join(caddyDir, "caddy.exe") : null,
		pg: dirs.find(isPgDir) ?? null,
	};
};

const pgVersion = (dir) =>
	(
		spawnSync(join(dir, "bin", "postgres.exe"), ["--version"], {
			encoding: "utf8",
		}).stdout ?? ""
	).match(/(\d+)\.\d+/)?.[1];

const missing = () =>
	[!hasCaddy() && "caddy.exe", !hasPg() && ".tools/pgsql"].filter(Boolean);

while (missing().length > 0 && !inputEnded) {
	say(`  missing: ${missing().join(", ")}`);
	const from = await prompt(
		"  Where can I copy them from? A project folder, the folder holding them,\n  or an unzipped download - anywhere on disk (empty to skip): ",
	);
	if (!from) {
		break;
	}
	const found = await findTools(from);
	if (!found.caddy && !found.pg) {
		say("  nothing usable found there.");
	}
	if (!hasCaddy() && found.caddy) {
		cpSync(found.caddy, caddyPath);
		say(`  copied caddy.exe from ${found.caddy}`);
	}
	if (!hasPg() && found.pg) {
		const major = pgVersion(found.pg);
		if (major && major !== String(project.postgresMajor)) {
			say(
				`  ${found.pg} is PostgreSQL ${major}, this project needs ${project.postgresMajor} - not copied.`,
			);
		} else {
			say(`  copying ${found.pg} -> .tools/pgsql (a few hundred MB)...`);
			for (const part of ["bin", "lib", "share"]) {
				if (existsSync(join(found.pg, part))) {
					cpSync(join(found.pg, part), join(pgPath, part), {
						recursive: true,
					});
				}
			}
			say("  copied .tools/pgsql");
		}
	}
}

if (
	!hasCaddy() &&
	(await confirm(
		"  Download caddy.exe (Windows amd64) from caddyserver.com now?",
	))
) {
	say("  downloading...");
	const response = await fetch(CADDY_DOWNLOAD_URL).catch((error) => error);
	if (response instanceof Response && response.ok) {
		writeFileSync(caddyPath, Buffer.from(await response.arrayBuffer()));
		say("  saved caddy.exe");
	} else {
		say(
			`  download failed (${response instanceof Response ? response.status : response.message})`,
		);
	}
}

say(
	`  caddy.exe     ${hasCaddy() ? "ok" : `missing - download Windows amd64 from ${CADDY_URL}, save as caddy.exe in the repo root`}`,
);
say(
	`  .tools/pgsql  ${hasPg() ? "ok" : `missing - PostgreSQL ${project.postgresMajor} Windows x86-64 zip from ${PG_BINARIES_URL}; unzip it, then run this again and point at the folder`}`,
);

// Caddy reads the domain and ports from here. `pnpm dev` rewrites it on every
// start; writing it now means Caddy also works when started by hand.
mkdirSync(toolsDir, { recursive: true });
writeFileSync(
	join(toolsDir, "caddy.env"),
	[
		`ZFS_DOMAIN=${devDomain}`,
		`ZFS_API_PORT=${portBase}`,
		`ZFS_WWW_PORT=${portBase + 1}`,
		"",
	].join("\r\n"),
);
say("  wrote .tools/caddy.env");

// --- 4. Hosts file ---------------------------------------------------------

heading("Hosts file");
if (devDomain.endsWith(".localhost")) {
	say("  not needed: browsers send *.localhost to 127.0.0.1 on their own.");
} else {
	const hosts = existsSync(HOSTS_FILE) ? readFileSync(HOSTS_FILE, "utf8") : "";
	const hasHost = (host) =>
		hosts.split(/\r?\n/).some((line) => {
			const parts = line.replace(/#.*/, "").trim().split(/\s+/);
			return parts.length > 1 && parts.slice(1).includes(host);
		});
	const missingHosts = [devDomain, `api.${devDomain}`].filter(
		(h) => !hasHost(h),
	);
	if (missingHosts.length === 0) {
		say("  ok");
	} else {
		say(`  Add these lines to ${HOSTS_FILE} (needs an admin editor):`);
		for (const h of missingHosts) {
			say(`    127.0.0.1  ${h}`);
		}
	}
}

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
say(`  https://${devDomain}      www`);
say(`  https://api.${devDomain}  api`);
say(`  http://127.0.0.1:${portBase + 8}  Drizzle Studio's local server`);
say("  git pull upstream main   later, to get skeleton updates");
rl.close();
