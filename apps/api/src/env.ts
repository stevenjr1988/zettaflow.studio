import { existsSync } from "node:fs";
import { z } from "zod";
import project from "../../../project.json" with { type: "json" };

// Dev: apps/api/.env. Prod: real environment variables (pm2), which win
// because loadEnvFile never overwrites a variable that is already set.
if (existsSync(".env")) {
	process.loadEnvFile(".env");
}

const EnvSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	PORT: z.coerce.number().int().positive().default(project.portBase),
	HOST: z.string().default("127.0.0.1"),
	DATABASE_URL: z.url().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
	console.error("Invalid environment:", z.prettifyError(parsed.error));
	process.exit(1);
}

export const env = parsed.data;
