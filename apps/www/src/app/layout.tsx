import type { Metadata } from "next";
import type { ReactNode } from "react";
import project from "../../../../project.json" with { type: "json" };
import "./globals.css";

export const metadata: Metadata = {
	title: project.title,
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body className="min-h-dvh bg-neutral-950 text-neutral-100 antialiased">
				{children}
			</body>
		</html>
	);
}
