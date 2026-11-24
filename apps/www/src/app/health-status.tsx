"use client";

import { ApiHealthSchema, WwwHealthSchema } from "@zfs/shared";
import { useEffect, useState } from "react";
import type { z } from "zod";

const REFRESH_MS = 10_000;

// Dev check for both servers:
//   www: browser -> www /_api_/_www_/health (handled by Next itself)
//   api: browser -> www /_api_/health -> api /health -> Postgres
export function HealthStatus() {
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			<HealthCard
				title="www"
				subtitle="Next.js · /_api_/_www_/health"
				url="/_api_/_www_/health"
				schema={WwwHealthSchema}
			/>
			<HealthCard
				title="api"
				subtitle="Hono · /_api_/health"
				url="/_api_/health"
				schema={ApiHealthSchema}
			/>
		</div>
	);
}

type Row = [label: string, value: string];

function HealthCard<S extends z.ZodType<Record<string, unknown>>>({
	title,
	subtitle,
	url,
	schema,
}: {
	title: string;
	subtitle: string;
	url: string;
	schema: S;
}) {
	const [rows, setRows] = useState<Row[] | null>(null);
	const [ok, setOk] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function check() {
			try {
				const res = await fetch(url, { cache: "no-store" });
				const body = schema.parse(await res.json());
				if (cancelled) {
					return;
				}
				setRows(
					Object.entries(body)
						.filter(([key]) => key !== "service")
						.map(([key, value]) => [
							key,
							key === "uptime"
								? `${Math.floor(Number(value))}s`
								: String(value),
						]),
				);
				setOk(body.status === "ok");
				setError(null);
			} catch (err) {
				if (!cancelled) {
					setOk(false);
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		}
		void check();
		const timer = setInterval(check, REFRESH_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [url, schema]);

	const dot = error
		? "bg-red-500"
		: rows === null
			? "bg-neutral-500"
			: ok
				? "bg-emerald-500"
				: "bg-amber-500";

	return (
		<section className="rounded-lg border border-neutral-800 p-4">
			<header className="mb-3 flex items-center gap-2">
				<span className={`size-2.5 rounded-full ${dot}`} />
				<h2 className="font-semibold">{title}</h2>
				<span className="text-neutral-500 text-xs">{subtitle}</span>
			</header>
			{error ? (
				<p className="font-mono text-red-400 text-sm">{error}</p>
			) : rows === null ? (
				<p className="text-neutral-400 text-sm">checking...</p>
			) : (
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-sm">
					{rows.map(([label, value]) => (
						<div key={label} className="contents">
							<dt className="text-neutral-400">{label}</dt>
							<dd>{value}</dd>
						</div>
					))}
				</dl>
			)}
		</section>
	);
}
