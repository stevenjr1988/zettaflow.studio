import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { type ApiHealth, ApiHealthSchema } from "@zfs/shared";
import { sql } from "drizzle-orm";
import project from "../../../project.json" with { type: "json" };
import type { Database } from "./db";

const healthRoute = createRoute({
	method: "get",
	path: "/health",
	tags: ["system"],
	summary: "Liveness and database check",
	responses: {
		200: {
			description: "Service status",
			content: { "application/json": { schema: ApiHealthSchema } },
		},
	},
});

export function createApp({ database }: { database: Database | null }) {
	const app = new OpenAPIHono();

	app.openapi(healthRoute, async (c) => {
		let db: ApiHealth["database"] = "not-configured";
		if (database) {
			db = await database.db
				.execute(sql`select 1`)
				.then(() => "up" as const)
				.catch(() => "down" as const);
		}
		return c.json(
			{
				service: "api",
				status: db === "down" ? "degraded" : "ok",
				uptime: process.uptime(),
				time: new Date().toISOString(),
				database: db,
			} satisfies ApiHealth,
			200,
		);
	});

	app.doc31("/openapi.json", {
		openapi: "3.1.0",
		info: { title: `${project.title} API`, version: "0.0.0" },
	});
	app.get("/docs", Scalar({ url: "/openapi.json" }));

	return app;
}
