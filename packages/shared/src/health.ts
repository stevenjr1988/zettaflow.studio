import { z } from "zod";

// Every service answers GET /health on its own port with at least these fields.
const base = {
	status: z.enum(["ok", "degraded"]),
	/** Seconds since the process started. */
	uptime: z.number().nonnegative(),
	time: z.iso.datetime(),
};

/** The real backend: Hono on portBase. Part of the public OpenAPI spec. */
export const ApiHealthSchema = z
	.object({
		service: z.literal("api"),
		...base,
		database: z.enum(["up", "down", "not-configured"]),
	})
	.meta({ id: "Health" });

export type ApiHealth = z.infer<typeof ApiHealthSchema>;

/** The Next.js app itself (its own server, not the api behind /_api_/*). */
export const WwwHealthSchema = z.object({
	service: z.literal("www"),
	...base,
});

export type WwwHealth = z.infer<typeof WwwHealthSchema>;
