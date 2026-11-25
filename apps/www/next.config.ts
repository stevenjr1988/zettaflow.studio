import type { NextConfig } from "next";
import project from "../../project.json" with { type: "json" };

const config: NextConfig = {
	// Workspace packages ship TypeScript source.
	transpilePackages: ["@zfs/gmsi", "@zfs/shared"],
	// Next blocks dev assets for unknown hosts; this is the name Caddy forwards.
	allowedDevOrigins: [project.devDomain, "192.168.*.*"],
};

export default config;
