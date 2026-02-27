import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";

import type { Insets, Rect, Viewport } from "./types.js";

export async function exists(filePath: string): Promise<boolean> {
	try {
		await fsp.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function collectSharedInputFiles(inputDir: string): Promise<string[]> {
	const files: string[] = [];
	if (await exists(inputDir)) {
		const entries = await fsp.readdir(inputDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			if (!entry.name.endsWith(".css") && !entry.name.endsWith(".js")) continue;
			files.push(path.join(inputDir, entry.name));
		}
	}

	const sourceFiles = await listFilesRecursive(import.meta.dir);
	for (const sourceFile of sourceFiles) {
		if (!sourceFile.endsWith(".ts") && !sourceFile.endsWith(".js")) continue;
		files.push(path.resolve(sourceFile));
	}

	return files.sort((a, b) => a.localeCompare(b));
}

export async function hashFiles(filePaths: string[]): Promise<string> {
	const hash = createHash("sha256");
	for (const filePath of filePaths) {
		hash.update(filePath);
		hash.update("\u0000");
		hash.update(await fsp.readFile(filePath));
		hash.update("\u0000");
	}
	return hash.digest("hex");
}

export function sha256Hex(...chunks: Array<string | Buffer | Uint8Array>): string {
	const hash = createHash("sha256");
	for (const chunk of chunks) {
		hash.update(chunk);
	}
	return hash.digest("hex");
}

export function pageHashFileName(htmlPath: string): string {
	const pageName = path.basename(htmlPath, path.extname(htmlPath));
	return `.hash-${sanitizePathSegment(pageName)}`;
}

export function sanitizeId(value: string): string {
	const cleaned = value.replace(/[^A-Za-z0-9]/g, "");
	if (!cleaned) return "Element";
	if (!/^[A-Za-z]/.test(cleaned)) return `E${cleaned}`;
	return cleaned;
}

export function sanitizePathSegment(value: string): string {
	const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_");
	return cleaned.length > 0 ? cleaned : "page";
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeUiString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function toPascalCase(value: string): string {
	const parts = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
	if (parts.length === 0) return "Page";
	return parts.map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
}

export function formatAlpha(value: number): string {
	const clamped = Math.max(0, Math.min(1, value));
	const rounded = Number(clamped.toFixed(3));
	return rounded.toString();
}

export function formatUiNumber(value: number): string {
	if (!Number.isFinite(value)) return "0";
	if (Number.isInteger(value)) return value.toString();
	return value.toFixed(3).replace(/0+$/g, "").replace(/\.$/, "");
}

export function parseCssColor(value: string | null): string | null {
	if (!value) return null;
	const trimmed = value.trim().toLowerCase();
	const hexMatch = trimmed.match(/^#([0-9a-f]{3,8})$/i);
	if (hexMatch) {
		let hex = hexMatch[1]!;
		if (hex.length === 3) {
			hex = hex
				.split("")
				.map(ch => ch + ch)
				.join("");
		} else if (hex.length === 4) {
			const expanded = hex
				.split("")
				.map(ch => ch + ch)
				.join("");
			const alpha = Number.parseInt(expanded.slice(6, 8), 16) / 255;
			return `#${expanded.slice(0, 6)}(${formatAlpha(alpha)})`;
		}
		if (hex.length === 6) return `#${hex}`;
		if (hex.length === 8) {
			const alpha = Number.parseInt(hex.slice(6, 8), 16) / 255;
			return `#${hex.slice(0, 6)}(${formatAlpha(alpha)})`;
		}
	}

	const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/);
	if (rgbMatch) {
		const parts = rgbMatch[1]!.split(",").map(part => part.trim());
		if (parts.length >= 3) {
			const r = Number.parseFloat(parts[0]!);
			const g = Number.parseFloat(parts[1]!);
			const b = Number.parseFloat(parts[2]!);
			if ([r, g, b].every(part => Number.isFinite(part))) {
				const hex = [r, g, b]
					.map(part =>
						Math.max(0, Math.min(255, Math.round(part)))
							.toString(16)
							.padStart(2, "0"),
					)
					.join("");
				const alpha = parts.length >= 4 ? Number.parseFloat(parts[3]!) : 1;
				if (!Number.isFinite(alpha) || alpha >= 1) {
					return `#${hex}`;
				}
				return `#${hex}(${formatAlpha(alpha)})`;
			}
		}
	}

	return null;
}

export function uiColorToCss(value: string): string {
	const match = value.match(/^#([0-9a-f]{6})(?:\(([^)]+)\))?$/i);
	if (!match) return value;
	const hex = match[1]!;
	const alpha = match[2];
	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);
	if (!alpha) return `rgb(${r}, ${g}, ${b})`;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function zeroInsets(): Insets {
	return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function sumInsets(a: Insets, b: Insets): Insets {
	return {
		top: a.top + b.top,
		right: a.right + b.right,
		bottom: a.bottom + b.bottom,
		left: a.left + b.left,
	};
}

export function hasInsets(insets: Insets): boolean {
	return insets.top !== 0 || insets.right !== 0 || insets.bottom !== 0 || insets.left !== 0;
}

export function computeClip(rect: Rect, viewport: Viewport): Rect | null {
	const x = Math.max(0, Math.round(rect.x));
	const y = Math.max(0, Math.round(rect.y));
	const right = Math.min(viewport.width, Math.round(rect.x + rect.width));
	const bottom = Math.min(viewport.height, Math.round(rect.y + rect.height));
	const width = right - x;
	const height = bottom - y;
	if (width <= 0 || height <= 0) return null;
	return { x, y, width, height };
}

export async function listFilesRecursive(dir: string): Promise<string[]> {
	const results: string[] = [];
	const stack: string[] = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		if (!(await exists(current))) continue;
		const entries = await fsp.readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
			} else if (entry.isFile()) {
				results.push(full);
			}
		}
	}
	return results;
}

export async function writeFileSafe(filePath: string, data: Buffer): Promise<void> {
	const dir = path.dirname(filePath);
	await fsp.mkdir(dir, { recursive: true });
	try {
		await fsp.writeFile(filePath, data);
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
			await fsp.mkdir(dir, { recursive: true });
			await fsp.writeFile(filePath, data);
			return;
		}
		throw error;
	}
}
