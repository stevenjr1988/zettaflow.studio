import type { WwwHealth } from "@zfs/shared";

// GET /_api_/_www_/health - www's own liveness (the Next server only).
//
// Every route www serves lives under /_api_/. Routes www handles itself go
// under /_api_/_www_/ (folder %5Fwww%5F); a specific folder always wins over
// the [...path] catch-all, so these never reach the api. Everything else under
// /_api_/ is forwarded to apps/api.
export function GET() {
	return Response.json({
		service: "www",
		status: "ok",
		uptime: process.uptime(),
		time: new Date().toISOString(),
	} satisfies WwwHealth);
}
