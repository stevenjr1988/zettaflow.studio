import project from "../../../../project.json" with { type: "json" };

/** The api's own origin. Server-side only: browsers go through /_api_/*. */
export const API_URL =
	process.env.API_URL ?? `http://127.0.0.1:${project.portBase}`;

/** httpOnly cookie holding the session token; www turns it into a Bearer header. */
export const SESSION_COOKIE = `${project.name}_session`;
