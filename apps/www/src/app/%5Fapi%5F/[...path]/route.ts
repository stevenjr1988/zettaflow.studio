import type { NextRequest } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/api";

// Browser -> www /_api_/* (cookie) -> api (Bearer). The api never sees cookies;
// www is just another client of it, like a mobile app or a game.
//
// The folder is "%5Fapi%5F" because Next treats folders starting with "_" as
// private (not routed); %5F is the encoded "_", so the URL is /_api_/*.
//
// /_api_/_www_/* is reserved for routes www handles itself (see
// %5Fwww%5F/). Those folders win over this catch-all; anything under _www_
// that reaches here has no handler and must not leak to the api.
const WWW_PREFIX = "/_www_";

// Hop-by-hop and browser-only headers that must not reach the api.
const DROP_REQUEST = [
	"host",
	"cookie",
	"connection",
	"content-length",
	"authorization",
];
// fetch() already decompressed the body, so these would now be wrong.
const DROP_RESPONSE = [
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
	"set-cookie",
];

async function forward(request: NextRequest) {
	const path = request.nextUrl.pathname.replace(/^\/_api_/, "") || "/";
	if (path === WWW_PREFIX || path.startsWith(`${WWW_PREFIX}/`)) {
		return Response.json({ error: "not found" }, { status: 404 });
	}
	const target = new URL(path + request.nextUrl.search, API_URL);

	const headers = new Headers(request.headers);
	for (const name of DROP_REQUEST) {
		headers.delete(name);
	}
	const token = request.cookies.get(SESSION_COOKIE)?.value;
	if (token) {
		headers.set("authorization", `Bearer ${token}`);
	}

	const hasBody = request.method !== "GET" && request.method !== "HEAD";
	let upstream: Response;
	try {
		upstream = await fetch(target, {
			method: request.method,
			headers,
			body: hasBody ? await request.arrayBuffer() : undefined,
			redirect: "manual",
			cache: "no-store",
		});
	} catch {
		return Response.json({ error: "api unreachable" }, { status: 502 });
	}

	const out = new Headers(upstream.headers);
	for (const name of DROP_RESPONSE) {
		out.delete(name);
	}
	return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const OPTIONS = forward;
export const HEAD = forward;
