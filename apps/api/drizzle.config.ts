import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not go through src/env.ts, so load apps/api/.env here.
if (!process.env.DATABASE_URL && existsSync(".env")) {
	process.loadEnvFile(".env");
}

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	casing: "snake_case",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "",
	},
});
