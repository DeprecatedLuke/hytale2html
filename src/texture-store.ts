import { promises as fsp } from "node:fs";
import path from "node:path";

import { PNG } from "pngjs";

import {
	DEDUPE_ALPHA_IGNORE_BELOW,
	DEDUPE_CHANNEL_TOLERANCE,
	DEDUPE_FINGERPRINT_SIZE,
	DEDUPE_MAX_MISMATCH_PIXELS,
	DEDUPE_SIMILARITY_THRESHOLD,
	SHARED_TEXTURE_PREFIX,
	SHARED_TEXTURES_DIR,
} from "./constants.js";
import type { DecodedPng, SharedTextureInfo } from "./types.js";
import { escapeRegExp, exists, listFilesRecursive, sha256Hex, writeFileSafe } from "./utils.js";

export function decodePng(buffer: Buffer): DecodedPng {
	const png = PNG.sync.read(buffer);
	return { width: png.width, height: png.height, data: png.data };
}

export function hashPngPixels(decoded: DecodedPng): string {
	return sha256Hex(`${decoded.width}x${decoded.height}\u0000`, decoded.data);
}

export function computeFingerprint(decoded: DecodedPng): string {
	const { width, height, data } = decoded;
	const size = DEDUPE_FINGERPRINT_SIZE;

	const out = new Uint8Array(size * size * 4);
	const quant = (v: number) => Math.max(0, Math.min(15, Math.round(v / 17)));
	for (let y = 0; y < size; y += 1) {
		const srcY = Math.min(height - 1, Math.floor(((y + 0.5) * height) / size));
		for (let x = 0; x < size; x += 1) {
			const srcX = Math.min(width - 1, Math.floor(((x + 0.5) * width) / size));
			const i = (srcY * width + srcX) * 4;
			const a = data[i + 3] ?? 0;
			const r = Math.round(((data[i] ?? 0) * a) / 255);
			const g = Math.round(((data[i + 1] ?? 0) * a) / 255);
			const b = Math.round(((data[i + 2] ?? 0) * a) / 255);

			const o = (y * size + x) * 4;
			out[o] = quant(r);
			out[o + 1] = quant(g);
			out[o + 2] = quant(b);
			out[o + 3] = quant(a);
		}
	}

	return sha256Hex(out);
}

export function countMismatchedPixels(params: {
	a: Buffer | Uint8Array;
	b: Buffer | Uint8Array;
	allowed: number;
}): number {
	const { a, b, allowed } = params;
	if (a.length !== b.length) return allowed + 1;

	let mismatches = 0;
	const tol = DEDUPE_CHANNEL_TOLERANCE;
	const alphaIgnore = DEDUPE_ALPHA_IGNORE_BELOW;

	for (let i = 0; i < a.length; i += 4) {
		const aA = a[i + 3] ?? 0;
		const bA = b[i + 3] ?? 0;
		if (aA <= alphaIgnore && bA <= alphaIgnore) continue;

		const aR = Math.round(((a[i] ?? 0) * aA) / 255);
		const aG = Math.round(((a[i + 1] ?? 0) * aA) / 255);
		const aB = Math.round(((a[i + 2] ?? 0) * aA) / 255);
		const bR = Math.round(((b[i] ?? 0) * bA) / 255);
		const bG = Math.round(((b[i + 1] ?? 0) * bA) / 255);
		const bB = Math.round(((b[i + 2] ?? 0) * bA) / 255);

		const dR = Math.abs(aR - bR);
		const dG = Math.abs(aG - bG);
		const dB = Math.abs(aB - bB);
		const dA = Math.abs(aA - bA);
		const delta = Math.max(dR, dG, dB, dA);
		if (delta > tol) {
			mismatches += 1;
			if (mismatches > allowed) return mismatches;
		}
	}

	return mismatches;
}

export class SharedTextureStore {
	private readonly exactHashToKey = new Map<string, string>();
	private readonly bucketToKeys = new Map<string, string[]>();
	private readonly keyToInfo = new Map<string, SharedTextureInfo>();
	private mutex: Promise<void> = Promise.resolve();

	constructor(private readonly params: { sharedDir: string; namespace: string }) {}

	async init(): Promise<void> {
		await fsp.mkdir(this.params.sharedDir, { recursive: true });

		const entries = await fsp.readdir(this.params.sharedDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const match = entry.name.match(new RegExp(`^(${SHARED_TEXTURE_PREFIX}[0-9a-f]{64})@2x\\.png$`));
			if (!match) continue;
			const keyFromName = match[1]!;

			const filePath = path.join(this.params.sharedDir, entry.name);
			const buffer = await fsp.readFile(filePath);
			const decoded = decodePng(buffer);
			const exactHash = hashPngPixels(decoded);
			const fingerprint = computeFingerprint(decoded);
			const bucketKey = this.bucketKey(decoded.width, decoded.height, fingerprint);

			const info: SharedTextureInfo = {
				key: keyFromName,
				width: decoded.width,
				height: decoded.height,
				fingerprint,
				filePath,
				texturePath: this.texturePathForKey(keyFromName),
			};

			this.keyToInfo.set(keyFromName, info);
			this.exactHashToKey.set(exactHash, keyFromName);
			const list = this.bucketToKeys.get(bucketKey) ?? [];
			list.push(keyFromName);
			list.sort();
			this.bucketToKeys.set(bucketKey, list);
		}
	}

	async register(buffer: Buffer): Promise<{ texturePath: string; filePath: string }> {
		return this.synchronized(async () => {
			const decoded = decodePng(buffer);
			const exactHash = hashPngPixels(decoded);
			const existingKey = this.exactHashToKey.get(exactHash);
			if (existingKey) {
				const info = this.keyToInfo.get(existingKey);
				if (info) return { texturePath: info.texturePath, filePath: info.filePath };
			}

			const fingerprint = computeFingerprint(decoded);
			const bucketKey = this.bucketKey(decoded.width, decoded.height, fingerprint);
			const candidates = this.bucketToKeys.get(bucketKey) ?? [];

			const totalPixels = decoded.width * decoded.height;
			const allowedByRatio = Math.floor(totalPixels * (1 - DEDUPE_SIMILARITY_THRESHOLD));
			const allowed = Math.min(allowedByRatio, DEDUPE_MAX_MISMATCH_PIXELS);

			let bestKey: string | null = null;
			let bestMismatches = Number.POSITIVE_INFINITY;

			for (const key of candidates) {
				const info = this.keyToInfo.get(key);
				if (!info) continue;
				if (info.width !== decoded.width || info.height !== decoded.height) continue;
				const candidateBuffer = await fsp.readFile(info.filePath);
				const candidateDecoded = decodePng(candidateBuffer);
				if (candidateDecoded.width !== decoded.width || candidateDecoded.height !== decoded.height) continue;

				const mismatches = countMismatchedPixels({ a: decoded.data, b: candidateDecoded.data, allowed });
				if (mismatches <= allowed) {
					if (mismatches < bestMismatches || (mismatches === bestMismatches && key < (bestKey ?? "~"))) {
						bestMismatches = mismatches;
						bestKey = key;
					}
				}
			}

			if (bestKey) {
				const info = this.keyToInfo.get(bestKey);
				if (info) {
					this.exactHashToKey.set(exactHash, bestKey);
					return { texturePath: info.texturePath, filePath: info.filePath };
				}
			}

			const key = `${SHARED_TEXTURE_PREFIX}${exactHash}`;
			const filePath = path.join(this.params.sharedDir, `${key}@2x.png`);
			const texturePath = this.texturePathForKey(key);

			if (!(await exists(filePath))) {
				await writeFileSafe(filePath, buffer);
			}

			const info: SharedTextureInfo = {
				key,
				width: decoded.width,
				height: decoded.height,
				fingerprint,
				filePath,
				texturePath,
			};

			this.keyToInfo.set(key, info);
			this.exactHashToKey.set(exactHash, key);
			const list = this.bucketToKeys.get(bucketKey) ?? [];
			list.push(key);
			list.sort();
			this.bucketToKeys.set(bucketKey, list);

			return { texturePath, filePath };
		});
	}

	private bucketKey(width: number, height: number, fingerprint: string): string {
		return `${width}x${height}:${fingerprint}`;
	}

	private texturePathForKey(key: string): string {
		return `${this.params.namespace}/${SHARED_TEXTURES_DIR}/${key}.png`;
	}

	private synchronized<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.mutex.then(fn, fn);
		this.mutex = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
}

export async function pruneUnusedSharedTextures(params: {
	uiOutputDir: string;
	resourcesRoot: string;
	namespace: string;
}): Promise<void> {
	const { uiOutputDir, resourcesRoot, namespace } = params;
	const sharedDir = path.join(resourcesRoot, "Common", "UI", "Custom", namespace, SHARED_TEXTURES_DIR);
	if (!(await exists(sharedDir))) return;

	const usedKeys = new Set<string>();
	const re = new RegExp(
		`${escapeRegExp(namespace)}/${SHARED_TEXTURES_DIR}/(${SHARED_TEXTURE_PREFIX}[0-9a-f]{64})\\.png`,
		"g",
	);

	const uiFiles = (await listFilesRecursive(uiOutputDir)).filter(file => file.endsWith(".ui"));
	for (const uiFile of uiFiles) {
		const contents = await fsp.readFile(uiFile, "utf8");
		for (const match of contents.matchAll(re)) {
			usedKeys.add(match[1]!);
		}
	}

	const entries = await fsp.readdir(sharedDir, { withFileTypes: true });
	let deleted = 0;
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const match = entry.name.match(new RegExp(`^(${SHARED_TEXTURE_PREFIX}[0-9a-f]{64})@2x\\.png$`));
		if (!match) continue;
		const key = match[1]!;
		if (usedKeys.has(key)) continue;
		await fsp.rm(path.join(sharedDir, entry.name), { force: true });
		deleted += 1;
	}

	if (deleted > 0) {
		console.log(`[ui-html] pruned ${deleted} unused shared textures.`);
	}
}
