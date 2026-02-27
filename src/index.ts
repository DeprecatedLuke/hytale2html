#!/usr/bin/env bun
import fs, { promises as fsp } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import type { Browser } from "puppeteer-core";

import { resolveChromePath } from "./browser.js";
import { parseArgs } from "./cli.js";
import { SHARED_TEXTURES_DIR } from "./constants.js";
import { compileTailwind } from "./html.js";
import { processPage, processStaticPage } from "./page-processor.js";
import { pruneUnusedSharedTextures, SharedTextureStore } from "./texture-store.js";
import { collectSharedInputFiles, exists, hashFiles, pageHashFileName, sanitizePathSegment } from "./utils.js";
import { formatValidationIssue, validateUiFile } from "./validator.js";

const listHtmlFiles = async (dir: string): Promise<string[]> =>
	fs.existsSync(dir)
		? (await fsp.readdir(dir)).filter(file => file.endsWith(".html")).map(file => path.join(dir, file))
		: [];

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const inputDir = args.input;
	const pagesDir = path.join(inputDir, "pages");
	const staticPagesDir = path.join(inputDir, "static-pages");
	const tailwindConfigPath = path.join(inputDir, "tailwind.config.js");

	if (!fs.existsSync(inputDir)) throw new Error(`Input directory not found: ${inputDir}`);

	const [htmlFiles, staticHtmlFiles] = await Promise.all([listHtmlFiles(pagesDir), listHtmlFiles(staticPagesDir)]);
	if (htmlFiles.length === 0 && staticHtmlFiles.length === 0) {
		console.log(`[ui-html] No HTML pages found in ${pagesDir} or ${staticPagesDir}. Nothing to generate.`);
		return;
	}
	if (!fs.existsSync(tailwindConfigPath)) throw new Error(`Tailwind config missing at ${tailwindConfigPath}`);

	const resourcesRoot = args.outResources;
	const uiOutputDir = args.outUi;
	const htmlOutputDir = args.outHtml;
	const sharedInputFiles = await collectSharedInputFiles(inputDir);
	const baseHref = new URL(`file://${inputDir}/`).href;
	const renderOutputDir = path.join(htmlOutputDir, "_render");
	await Promise.all([fsp.mkdir(uiOutputDir, { recursive: true }), fsp.mkdir(renderOutputDir, { recursive: true })]);

	const allPages = [
		...htmlFiles.map(htmlPath => ({ htmlPath, isStatic: false })),
		...staticHtmlFiles.map(htmlPath => ({ htmlPath, isStatic: true })),
	];
	const dirtyPages: typeof allPages = [];
	const pageHashes = new Map<string, string>();

	for (const page of allPages) {
		const pageHash = await hashFiles([...sharedInputFiles, page.htmlPath]);
		const hashFile = path.join(uiOutputDir, pageHashFileName(page.htmlPath));
		pageHashes.set(page.htmlPath, pageHash);

		if (args.check && !args.force) {
			const storedHash = (await exists(hashFile)) ? (await fsp.readFile(hashFile, "utf8")).trim() : null;
			if (storedHash === pageHash) {
				const pageName = path.basename(page.htmlPath, path.extname(page.htmlPath));
				console.log(`[ui-html] ${pageName}: up-to-date.`);
				continue;
			}
		}
		dirtyPages.push(page);
	}

	if (dirtyPages.length === 0) {
		console.log("[ui-html] all pages up-to-date.");
		return;
	}

	const css = await compileTailwind(tailwindConfigPath, inputDir);

	for (const page of dirtyPages) {
		const pageName = path.basename(page.htmlPath, path.extname(page.htmlPath));
		const pageSlug = sanitizePathSegment(pageName);
		const pageResourceDir = path.join(resourcesRoot, "Common", "UI", "Custom", args.namespace, pageSlug);
		await fsp.rm(pageResourceDir, { recursive: true, force: true });
		if (page.isStatic) {
			const staticPath = path.join(
				resourcesRoot,
				"Common",
				"UI",
				"Custom",
				args.namespace,
				"static-pages",
				`${pageSlug}@2x.png`,
			);
			await fsp.rm(staticPath, { force: true }).catch(() => {});
		}
	}

	const sharedTexturesDir = path.join(resourcesRoot, "Common", "UI", "Custom", args.namespace, SHARED_TEXTURES_DIR);
	const textureStore = new SharedTextureStore({ sharedDir: sharedTexturesDir, namespace: args.namespace });
	await textureStore.init();

	const chromePath = resolveChromePath();
	const chromeArgs = [
		"--no-sandbox",
		"--disable-setuid-sandbox",
		"--disable-gpu",
		"--disable-dev-shm-usage",
		"--disable-extensions",
		"--disable-background-networking",
		"--hide-scrollbars",
		"--mute-audio",
		"--disable-software-rasterizer",
		"--no-first-run",
		"--disable-features=TranslateUI",
		"--disable-default-apps",
		"--disable-sync",
		"--disable-component-update",
		"--disable-hang-monitor",
		"--metrics-recording-only",
		"--safebrowsing-disable-auto-update",
	];
	const launchBrowser = () => puppeteer.launch({ headless: true, executablePath: chromePath, args: chromeArgs });
	const withBrowser = async <T>(fn: (browser: Browser) => Promise<T>): Promise<T> => {
		const browser = await launchBrowser();
		try {
			return await fn(browser);
		} finally {
			await browser.close();
		}
	};

	const dirtyNormal = dirtyPages.filter(p => !p.isStatic).map(p => p.htmlPath);
	const dirtyStatic = dirtyPages.filter(p => p.isStatic).map(p => p.htmlPath);

	await Promise.all([
		...dirtyNormal.map(htmlPath =>
			withBrowser(browser =>
				processPage({
					browser,
					htmlPath,
					css,
					viewport: args.viewport,
					textureStore,
					uiOutputDir,
					htmlOutputDir,
					baseHref,
					renderOutputDir,
				}),
			),
		),
		...dirtyStatic.map(htmlPath =>
			withBrowser(async browser => {
				const page = await browser.newPage();
				await page.setViewport({ width: args.viewport.width, height: args.viewport.height, deviceScaleFactor: 1 });
				await processStaticPage({
					page,
					htmlPath,
					css,
					viewport: args.viewport,
					namespace: args.namespace,
					resourcesRoot,
					baseHref,
					renderOutputDir,
				});
				await page.close();
			}),
		),
	]);

	let totalValidationIssues = 0;
	for (const htmlPath of dirtyNormal) {
		const pageName = path.basename(htmlPath, path.extname(htmlPath));
		const pageSlug = sanitizePathSegment(pageName);
		const uiPath = path.join(uiOutputDir, `${pageSlug}.ui`);
		if (!(await exists(uiPath))) continue;

		const validation = await validateUiFile(uiPath);
		if (validation.issues.length === 0) continue;

		totalValidationIssues += validation.issues.length;
		console.warn(`[ui-html] ${pageName}: ${validation.issues.length} UI validation issue(s).`);
		for (const issue of validation.issues) {
			console.warn(`[ui-html]   ${formatValidationIssue(issue)}`);
		}
	}

	if (args.strictValidate && totalValidationIssues > 0) {
		throw new Error(`[ui-html] strict validation failed with ${totalValidationIssues} issue(s).`);
	}

	await Promise.all(
		dirtyPages.map(page => {
			const hash = pageHashes.get(page.htmlPath)!;
			const hashFile = path.join(uiOutputDir, pageHashFileName(page.htmlPath));
			return fsp.writeFile(hashFile, `${hash}\n`, "utf8");
		}),
	);

	await pruneUnusedSharedTextures({ uiOutputDir, resourcesRoot, namespace: args.namespace });
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
