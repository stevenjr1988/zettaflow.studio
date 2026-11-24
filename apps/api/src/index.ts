import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createDb } from "./db";
import { env } from "./env";

const SHUTDOWN_DEADLINE_MS = 5_000;

const database = env.DATABASE_URL ? createDb(env.DATABASE_URL) : null;

const server = serve(
	{
		fetch: createApp({ database }).fetch,
		port: env.PORT,
		hostname: env.HOST,
	},
	(info) => {
		console.log(`api listening on http://${info.address}:${info.port}`);
		console.log(
			database
				? "database: configured"
				: "database: DATABASE_URL not set - run pnpm db:init",
		);
	},
);

let shuttingDown = false;
async function shutdown(signal: string) {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	console.log(`${signal} - shutting down`);
	setTimeout(() => process.exit(1), SHUTDOWN_DEADLINE_MS).unref();

	if ("closeAllConnections" in server) {
		server.closeAllConnections();
	}
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await database?.pool.end();
	process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
