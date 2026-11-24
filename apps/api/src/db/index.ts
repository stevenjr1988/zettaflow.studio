import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDb(url: string) {
	const pool = new Pool({ connectionString: url });
	const db = drizzle({ client: pool, schema, casing: "snake_case" });
	return { db, pool };
}

export type Database = ReturnType<typeof createDb>;
