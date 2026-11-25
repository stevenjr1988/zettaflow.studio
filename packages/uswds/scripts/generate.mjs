// Generates src/palette.css and src/theme.css from the USWDS design tokens.
// Run: pnpm --filter @zfs/uswds generate
// To update, change USWDS_VERSION to a newer release tag and run it again.

import { writeFile } from "node:fs/promises";

const USWDS_VERSION = "v3.14.0";

const RAW = `https://raw.githubusercontent.com/uswds/uswds/${USWDS_VERSION}`;
const API = `https://api.github.com/repos/uswds/uswds/contents/packages/uswds-tokens/colors?ref=${USWDS_VERSION}`;
const SETTINGS = `${RAW}/packages/uswds-core/src/styles/settings/_settings-color.scss`;

const header = (what) =>
	[
		`/* USWDS ${what}, generated from USWDS ${USWDS_VERSION} by scripts/generate.mjs.`,
		" * Do not edit by hand. Source: https://github.com/uswds/uswds (public domain, CC0 1.0). */",
	].join("\n");

const fetchOk = async (url, as) => {
	const res = await fetch(url, {
		headers: { "User-Agent": "zfs-uswds-generator" },
	});
	if (!res.ok) {
		throw new Error(`${res.status} ${res.statusText}: ${url}`);
	}
	return as === "json" ? res.json() : res.text();
};

// Grades sort numerically; "5v" style names come from the vivid group.
const gradeOrder = (a, b) =>
	Number.parseInt(a.grade, 10) - Number.parseInt(b.grade, 10) ||
	a.grade.length - b.grade.length;

const familyColors = (prop) => {
	const out = [];
	for (const entry of prop.value) {
		if (entry.name === "vivid") {
			for (const v of entry.value) {
				if (typeof v.value === "string") {
					out.push({ grade: `${v.name}v`, hex: v.value.toLowerCase() });
				}
			}
		} else if (typeof entry.value === "string") {
			out.push({ grade: entry.name, hex: entry.value.toLowerCase() });
		}
	}
	return out.sort(gradeOrder);
};

const buildPalette = async () => {
	const listing = await fetchOk(API, "json");
	const files = listing
		.filter((f) => f.name.endsWith(".json"))
		.map((f) => f.name)
		.sort();

	const lines = [
		header("color palette"),
		"",
		"/* Tailwind v4: bg-uswds-blue-60v, text-uswds-gray-90, border-uswds-red-cool-50 …",
		" * CSS: var(--color-uswds-blue-60v). `static` keeps every variable in the output.",
		" * AA contrast: a grade difference of 50+ passes for text, 40+ for large text and UI. */",
		"@theme static {",
		"\t--color-uswds-white: #ffffff;",
		"\t--color-uswds-black: #000000;",
	];
	const known = new Set(["white", "black"]);

	for (const file of files) {
		const json = await fetchOk(
			`${RAW}/packages/uswds-tokens/colors/${file}`,
			"json",
		);
		for (const prop of json.props) {
			lines.push("");
			for (const { grade, hex } of familyColors(prop)) {
				const name = `${prop.name}-${grade}`;
				known.add(name);
				lines.push(`\t--color-uswds-${name}: ${hex};`);
			}
		}
	}
	lines.push("}", "");
	return { css: lines.join("\n"), known };
};

const buildTheme = async (known) => {
	const scss = await fetchOk(SETTINGS, "text");
	const re = /^\$theme-color-([a-z-]+):\s*"([a-z0-9-]+)"\s*!default;/gm;
	const lines = [
		header("default theme"),
		"",
		"/* Semantic colors from the USWDS default theme, pointing at the palette.",
		" * Tailwind v4: bg-uswds-primary, text-uswds-base-ink, border-uswds-error-dark …",
		" * Override any of them after this import to make your own theme. */",
		'@import "./palette.css";',
		"",
		"@theme static {",
	];
	for (const [, role, token] of scss.matchAll(re)) {
		if (role.endsWith("-family")) {
			continue;
		}
		if (!known.has(token)) {
			throw new Error(`theme ${role} -> ${token}: not in the palette`);
		}
		lines.push(`\t--color-uswds-${role}: var(--color-uswds-${token});`);
	}
	lines.push("}", "");
	return lines.join("\n");
};

const { css, known } = await buildPalette();
const theme = await buildTheme(known);
const dir = new URL("../src/", import.meta.url);
await writeFile(new URL("palette.css", dir), css);
await writeFile(new URL("theme.css", dir), theme);
console.log(`USWDS ${USWDS_VERSION}: ${known.size} palette colors written.`);
