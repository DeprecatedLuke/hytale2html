import path from "node:path";

import { DEFAULT_VIEWPORT } from "./constants.js";
import type { Args, Viewport } from "./types.js";

export function parseArgs(argv: string[]): Args {
	const raw: Record<string, string> = {};
	const flags = new Set<string>();
	const booleanFlags = new Set(["check", "force", "strict-validate"]);
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg || !arg.startsWith("--")) continue;
		const key = arg.slice(2);
		if (booleanFlags.has(key)) {
			flags.add(key);
			continue;
		}
		const value = argv[i + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`Missing value for --${key}`);
		}
		raw[key] = value;
		i += 1;
	}

	if (!raw.input) throw new Error("--input is required");
	if (!raw["out-resources"]) throw new Error("--out-resources is required");
	if (!raw["out-ui"]) throw new Error("--out-ui is required");

	const outResources = path.resolve(raw["out-resources"]);
	const outUi = path.resolve(raw["out-ui"]);
	const outHtml = raw["out-html"] ? path.resolve(raw["out-html"]) : path.resolve(outResources, "..", "html");

	return {
		input: path.resolve(raw.input),
		outResources,
		outUi,
		outHtml,
		viewport: raw.viewport ? parseViewport(raw.viewport) : DEFAULT_VIEWPORT,
		namespace: raw.namespace ?? "HTML",
		check: flags.has("check") || !flags.has("force"),
		strictValidate: flags.has("strict-validate"),
		force: flags.has("force"),
	};
}

export function parseViewport(value: string): Viewport {
	const match = value.toLowerCase().match(/^(\d+)x(\d+)$/);
	if (!match) throw new Error(`Invalid viewport "${value}". Expected 1920x1080.`);
	return { width: Number(match[1]), height: Number(match[2]) };
}
