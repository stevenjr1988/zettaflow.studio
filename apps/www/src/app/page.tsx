import project from "../../../../project.json" with { type: "json" };
import { HealthStatus } from "./health-status";

export default function Home() {
	return (
		<main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
			<h1 className="font-semibold text-2xl">{project.title}</h1>
			<HealthStatus />
		</main>
	);
}
