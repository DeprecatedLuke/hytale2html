import { promises as fsp } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type * as puppeteer from "puppeteer-core";
import { captureElementStateBuffer, prepareElement, restoreElement, waitForFonts } from "./browser.js";
import { FONT_READY_TIMEOUT_MS, HIRES_THRESHOLD } from "./constants.js";
import { buildPreviewHtml, injectStyle } from "./html.js";
import type { SharedTextureStore } from "./texture-store.js";
import type { ElementTask, GeneratedElement, RawElement, Viewport } from "./types.js";
import { buildLabelStyle, buildUiFile, normalizeLayoutMode } from "./ui-generator.js";
import { computeClip, sanitizeId, sanitizePathSegment, toPascalCase, writeFileSafe } from "./utils.js";

export function flattenElements(elements: GeneratedElement[]): GeneratedElement[] {
	const result: GeneratedElement[] = [];
	const visit = (nodes: GeneratedElement[]) => {
		for (const node of nodes) {
			result.push(node);
			if (node.children.length > 0) {
				visit(node.children);
			}
		}
	};
	visit(elements);
	return result;
}

export async function processStaticPage(params: {
	page: puppeteer.Page;
	htmlPath: string;
	css: string;
	viewport: Viewport;
	namespace: string;
	resourcesRoot: string;
	baseHref: string;
	renderOutputDir: string;
}): Promise<void> {
	const { page, htmlPath, css, viewport, namespace, resourcesRoot, baseHref, renderOutputDir } = params;
	const rawHtml = await fsp.readFile(htmlPath, "utf8");
	const pageName = path.basename(htmlPath, path.extname(htmlPath));
	const pageSlug = sanitizePathSegment(pageName);
	const html = injectStyle(rawHtml, css, baseHref);

	const renderPath = path.join(renderOutputDir, `${pageSlug}.html`);
	await fsp.writeFile(renderPath, html, "utf8");
	await page.goto(pathToFileURL(renderPath).href, { waitUntil: "domcontentloaded" });
	await waitForFonts(page, FONT_READY_TIMEOUT_MS);

	const staticPagesDir = path.join(resourcesRoot, "Common", "UI", "Custom", namespace, "static-pages");
	const staticPagePath = path.join(staticPagesDir, `${pageSlug}@2x.png`);
	const staticBuffer = (await page.screenshot({
		clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
	})) as Buffer;
	await writeFileSafe(staticPagePath, staticBuffer);

	console.log(`[ui-html] ${pageName}: generated static page.`);
}

export async function processElementChunk(params: {
	page: puppeteer.Page;
	tasks: ElementTask[];
	textureStore: SharedTextureStore;
	pageName: string;
	viewport: Viewport;
}): Promise<Array<[number, GeneratedElement]>> {
	const { page, tasks, textureStore, pageName, viewport } = params;
	const results: Array<[number, GeneratedElement]> = [];

	for (const { raw, id, clip } of tasks) {
		const handle = await page.$(`[data-hy-idx="${raw.idx}"]`);
		if (!handle) {
			console.warn(`[ui-html] ${pageName}: unable to resolve element ${id}.`);
			continue;
		}

		const textures: Record<string, string> = {};
		const files: Record<string, string> = {};
		let selectedTexture: string | undefined;
		let focusTexture: string | undefined;

		if (!raw.isLabel) {
			const stateList = ["default"] as string[];
			if (raw.isButton) {
				stateList.push("hover", "pressed");
			}
			if (raw.disabled || raw.dataState === "disabled") {
				stateList.push("disabled");
			}
			const hasSelected = raw.dataState === "selected";
			const hasFocus = raw.dataState === "focus";
			if (hasSelected) stateList.push("selected");
			if (hasFocus) stateList.push("focus");

			await prepareElement(page, handle, raw.useBackdrop);
			const needsHires = raw.hasText || (clip.width <= HIRES_THRESHOLD && clip.height <= HIRES_THRESHOLD);
			const scaleFactor = needsHires ? 2 : 1;
			await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: scaleFactor });
			try {
				await page.evaluate(() => new Promise(requestAnimationFrame));
				for (const state of stateList) {
					const buffer = await captureElementStateBuffer({ page, handle, clip, state });
					const { texturePath, filePath } = await textureStore.register(buffer);
					files[state] = filePath;
					if (state === "selected") {
						selectedTexture = texturePath;
					} else if (state === "focus") {
						focusTexture = texturePath;
					} else {
						textures[state] = texturePath;
					}
				}
			} finally {
				await restoreElement(page, handle);
				await page.mouse.move(0, 0);
			}
		}

		results.push([
			raw.idx,
			{
				id,
				rect: clip,
				anchorTokens: raw.anchorTokens,
				padding: raw.padding,
				border: raw.border,
				isButton: raw.isButton,
				textures,
				files,
				dataState: raw.dataState,
				disabled: raw.disabled,
				selectedTexture,
				focusTexture,
				children: [],
				zIndex: raw.zIndex,
				order: raw.order,
				layoutMode: normalizeLayoutMode(raw.layoutMode),
				flexWeight: raw.flexWeight,
				isLabel: raw.isLabel,
				text: raw.text,
				textBinding: raw.textBinding,
				labelStyle: buildLabelStyle(raw.textStyle),
				hidden: raw.hidden,
				clipChildren: raw.clipChildren,
				tooltip: raw.tooltip,
				outline: raw.outline,
				hitTestVisible: raw.hitTestVisible,
				mask: raw.mask,
				spacing: raw.spacing,
				margin: raw.margin,
			},
		]);
	}

	return results;
}

export async function processPage(params: {
	browser: puppeteer.Browser;
	htmlPath: string;
	css: string;
	viewport: Viewport;
	textureStore: SharedTextureStore;
	uiOutputDir: string;
	htmlOutputDir: string;
	baseHref: string;
	renderOutputDir: string;
}): Promise<void> {
	const { browser, htmlPath, css, viewport, textureStore, uiOutputDir, htmlOutputDir, baseHref, renderOutputDir } =
		params;
	const rawHtml = await fsp.readFile(htmlPath, "utf8");
	const pageName = path.basename(htmlPath, path.extname(htmlPath));
	const pageSlug = sanitizePathSegment(pageName);
	const pageClass = toPascalCase(pageName);
	const html = injectStyle(rawHtml, css, baseHref);

	const renderPath = path.join(renderOutputDir, `${pageSlug}.html`);
	await fsp.writeFile(renderPath, html, "utf8");
	const renderUrl = pathToFileURL(renderPath).href;

	const page = await browser.newPage();
	await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
	await page.goto(renderUrl, { waitUntil: "domcontentloaded" });
	await waitForFonts(page, FONT_READY_TIMEOUT_MS);

	const hasSceneBlur = await page.evaluate(
		() => !!document.querySelector('[data-hy-scene-blur], [data-hy-role="scene-blur"], [data-hy-blur="scene"]'),
	);
	if (hasSceneBlur) {
		await page.addStyleTag({
			content:
				'[data-hy-scene-blur], [data-hy-role="scene-blur"], [data-hy-blur="scene"] { display: none !important; }',
		});
	}

	const rawElements: RawElement[] = await page.evaluate(() => {
		const results: RawElement[] = [];
		const elements = Array.from(document.body.querySelectorAll("*"));
		const parsePx = (value: string | null) => {
			const parsed = Number.parseFloat(value ?? "0");
			return Number.isFinite(parsed) ? Math.round(parsed) : 0;
		};
		const parseLayout = (value: string | null) => {
			if (!value) return null;
			const normalized = value.replace(/[^A-Za-z]/g, "").toLowerCase();
			switch (normalized) {
				case "none":
					return "none";
				case "top":
					return "Top";
				case "left":
					return "Left";
				case "right":
					return "Right";
				case "bottom":
					return "Bottom";
				case "center":
					return "Center";
				case "middle":
					return "Middle";
				case "full":
					return "Full";
				case "topscrolling":
					return "TopScrolling";
				case "leftcenterwrap":
					return "LeftCenterWrap";
				case "centermiddle":
					return "CenterMiddle";
				case "middlecenter":
					return "MiddleCenter";
				default:
					return null;
			}
		};
		let order = 0;
		let idx = 0;

		for (const element of elements) {
			const tag = element.tagName.toLowerCase();
			if (tag === "script" || tag === "style" || tag === "head") continue;
			if (element === document.body || element === document.documentElement) continue;

			const rect = element.getBoundingClientRect();
			const computed = window.getComputedStyle(element);
			if (rect.width <= 0 || rect.height <= 0) continue;
			if (computed.display === "none" || computed.visibility === "hidden" || computed.opacity === "0") continue;

			const rawId = element.getAttribute("data-hy-id") || element.id || null;
			if (!rawId) continue;
			const dataState = element.getAttribute("data-state");
			const disabled = element.hasAttribute("disabled");
			const role = element.getAttribute("data-hy-role");
			const blurAttr = element.getAttribute("data-hy-blur");
			const isSceneBlur =
				element.hasAttribute("data-hy-scene-blur") || role === "scene-blur" || blurAttr === "scene";
			if (isSceneBlur) continue;
			const anchorAttr = element.getAttribute("data-hy-anchor");
			const anchorTokens = anchorAttr ? anchorAttr.split(/\s+/).filter(Boolean) : [];
			const layoutAttr = element.getAttribute("data-hy-layout");
			const flexAttr = element.getAttribute("data-hy-flex");
			const textAttr = element.getAttribute("data-hy-text");
			const textBinding = element.getAttribute("data-hy-text-binding");
			const fontAttr = element.getAttribute("data-hy-font");
			const skipRender = element.hasAttribute("data-hy-skip-render") || element.hasAttribute("data-hy-backdrop");
			const useBackdrop = element.hasAttribute("data-hy-use-backdrop");
			const hidden = element.hasAttribute("data-hy-hidden") || element.getAttribute("data-hy-visible") === "false";
			const bleedAttr = element.getAttribute("data-hy-bleed");
			const bleed = bleedAttr ? Math.max(0, Math.round(Number.parseFloat(bleedAttr) || 0)) : 0;
			const isLabel = role === "label" || textAttr !== null || textBinding !== null;
			const hasText =
				!isLabel &&
				(() => {
					// Check if element has visible text that isn't inside a child data-hy-id element
					// (those are captured separately and hidden during this element's screenshot)
					const hasOwnText = (el: Element): boolean => {
						for (const node of Array.from(el.childNodes)) {
							if (node.nodeType === 3 && (node.textContent ?? "").trim().length > 0) return true;
							if (node.nodeType === 1) {
								const child = node as Element;
								if (!child.hasAttribute("data-hy-id") && hasOwnText(child)) return true;
							}
						}
						return false;
					};
					return hasOwnText(element);
				})();
			const typeAttr = element.getAttribute("type")?.toLowerCase() || "";
			const isButton =
				!isLabel &&
				(tag === "button" ||
					tag === "a" ||
					(tag === "input" && ["button", "submit", "checkbox", "radio"].includes(typeAttr)) ||
					role === "button");

			const zIndexValue = Number.parseInt(computed.zIndex || "0", 10);
			const zIndex = Number.isFinite(zIndexValue) ? zIndexValue : 0;

			const layoutMode = parseLayout(layoutAttr);
			let spacing = 0;
			const spacingAttr = element.getAttribute("data-hy-spacing");
			if (spacingAttr) {
				spacing = Math.max(0, Math.round(Number.parseFloat(spacingAttr) || 0));
			}

			// Extract gap from CSS for flex containers (even if layoutMode is manually specified)
			if ((computed.display === "flex" || computed.display === "inline-flex") && spacing === 0) {
				const direction = computed.flexDirection;
				const isColumn = direction === "column" || direction === "column-reverse";
				// Use getPropertyValue for gap properties as they may not be exposed as direct properties
				const rowGapValue = computed.getPropertyValue("row-gap") || computed.getPropertyValue("gap") || "0";
				const columnGapValue = computed.getPropertyValue("column-gap") || computed.getPropertyValue("gap") || "0";
				const relevantGap = isColumn ? parsePx(rowGapValue) : parsePx(columnGapValue);
				if (relevantGap > 0) {
					spacing = relevantGap;
				}
			}

			// Layout mode only from explicit data-hy-layout attribute
			// (auto-detection from flex removed - causes issues when intermediate elements lack data-hy-id)

			let flexWeight: number | null = null;
			if (flexAttr) {
				const parsedFlex = Number.parseFloat(flexAttr);
				flexWeight = Number.isFinite(parsedFlex) ? parsedFlex : null;
			} else {
				const flexGrow = Number.parseFloat(computed.flexGrow || "0");
				flexWeight = Number.isFinite(flexGrow) && flexGrow > 0 ? flexGrow : null;
			}

			let parentIdx: number | null = null;
			let parent = element.parentElement;
			while (parent) {
				const parentAttr = parent.getAttribute("data-hy-idx");
				if (parentAttr !== null) {
					const parsed = Number.parseInt(parentAttr, 10);
					parentIdx = Number.isFinite(parsed) ? parsed : null;
					break;
				}
				parent = parent.parentElement;
			}

			const padding = {
				top: parsePx(computed.paddingTop),
				right: parsePx(computed.paddingRight),
				bottom: parsePx(computed.paddingBottom),
				left: parsePx(computed.paddingLeft),
			};
			const border = {
				top: parsePx(computed.borderTopWidth),
				right: parsePx(computed.borderRightWidth),
				bottom: parsePx(computed.borderBottomWidth),
				left: parsePx(computed.borderLeftWidth),
			};
			const margin = {
				top: parsePx(computed.marginTop),
				right: parsePx(computed.marginRight),
				bottom: parsePx(computed.marginBottom),
				left: parsePx(computed.marginLeft),
			};
			const textStyle = isLabel
				? {
						fontSize: parsePx(computed.fontSize),
						color: computed.color,
						fontWeight: computed.fontWeight,
						fontStyle: computed.fontStyle,
						textTransform: computed.textTransform,
						textDecoration: computed.textDecoration,
						letterSpacing: parsePx(computed.letterSpacing),
						textAlign: computed.textAlign,
						verticalAlign: element.getAttribute("data-hy-valign") || computed.verticalAlign,
						whiteSpace: computed.whiteSpace,
						fontName: fontAttr,
						maxLines: element.hasAttribute("data-hy-max-lines")
							? Number.parseInt(element.getAttribute("data-hy-max-lines") || "0", 10) || null
							: null,
					}
				: null;
			const textContent = isLabel ? (textAttr ?? element.textContent ?? "") : null;

			// New properties: clipChildren, tooltip, outline, hitTestVisible, mask
			const clipAttr = element.hasAttribute("data-hy-clip");
			const clipFromCss =
				computed.overflow === "hidden" || computed.overflowX === "hidden" || computed.overflowY === "hidden";
			const clipChildren = clipAttr || clipFromCss;

			const tooltip = element.getAttribute("data-hy-tooltip");

			let outline: { size: number; color: string } | null = null;
			const outlineAttr = element.getAttribute("data-hy-outline");
			if (outlineAttr) {
				// Format: "size color" e.g. "2 #ff0000" or "2 #ff0000(0.5)"
				const outlineParts = outlineAttr.trim().split(/\s+/);
				if (outlineParts.length >= 2) {
					const size = Number.parseFloat(outlineParts[0]!);
					const color = outlineParts.slice(1).join(" ");
					if (Number.isFinite(size) && size > 0 && color) {
						outline = { size, color };
					}
				}
			} else {
				// Extract from CSS outline
				const outlineWidth = parsePx(computed.outlineWidth);
				if (outlineWidth > 0 && computed.outlineStyle !== "none") {
					outline = { size: outlineWidth, color: computed.outlineColor };
				}
			}

			const hitTestVisible = element.hasAttribute("data-hy-hit-test");
			const mask = element.getAttribute("data-hy-mask");

			element.setAttribute("data-hy-idx", String(idx));

			results.push({
				idx,
				rawId,
				tag,
				dataState,
				disabled,
				rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
				zIndex,
				isButton,
				order,
				anchorTokens,
				parentIdx,
				padding,
				border,
				layoutMode,
				flexWeight,
				isLabel,
				text: textContent ? textContent.trim() : null,
				textBinding,
				textStyle,
				skipRender,
				useBackdrop,
				bleed,
				hasText,
				hidden,
				clipChildren,
				tooltip,
				outline,
				hitTestVisible,
				mask,
				spacing,
				margin,
			});

			order += 1;
			idx += 1;
		}

		return results;
	});

	if (rawElements.length === 0) {
		console.log(`[ui-html] ${pageName}: no elements found.`);
		return;
	}

	rawElements.sort((a, b) => a.zIndex - b.zIndex || a.order - b.order);

	const rawByIdx = new Map(rawElements.map(raw => [raw.idx, raw]));
	const elementsByIdx = new Map<number, GeneratedElement>();

	// Pre-compute IDs and partition into screenshot tasks vs labels
	const usedIds = new Map<string, number>();
	const screenshotTasks: ElementTask[] = [];

	for (const raw of rawElements) {
		if (raw.skipRender) continue;

		const baseId = raw.rawId ?? `${raw.tag}${raw.order}`;
		const sanitized = sanitizeId(baseId);
		const count = usedIds.get(sanitized) ?? 0;
		const id = count === 0 ? sanitized : `${sanitized}${count + 1}`;
		usedIds.set(sanitized, count + 1);

		const bleedRect =
			raw.bleed > 0
				? {
						x: raw.rect.x - raw.bleed,
						y: raw.rect.y - raw.bleed,
						width: raw.rect.width + raw.bleed * 2,
						height: raw.rect.height + raw.bleed * 2,
					}
				: raw.rect;
		const clip = computeClip(bleedRect, viewport);
		if (!clip) {
			console.warn(`[ui-html] ${pageName}: skipping ${id} (out of bounds).`);
			continue;
		}

		if (raw.isLabel) {
			// Labels don't need screenshots — add directly
			elementsByIdx.set(raw.idx, {
				id,
				rect: clip,
				anchorTokens: raw.anchorTokens,
				padding: raw.padding,
				border: raw.border,
				isButton: false,
				textures: {},
				files: {},
				dataState: raw.dataState,
				disabled: raw.disabled,
				children: [],
				zIndex: raw.zIndex,
				order: raw.order,
				layoutMode: normalizeLayoutMode(raw.layoutMode),
				flexWeight: raw.flexWeight,
				isLabel: true,
				text: raw.text,
				textBinding: raw.textBinding,
				labelStyle: buildLabelStyle(raw.textStyle),
				hidden: raw.hidden,
				clipChildren: raw.clipChildren,
				tooltip: raw.tooltip,
				outline: raw.outline,
				hitTestVisible: raw.hitTestVisible,
				mask: raw.mask,
				spacing: raw.spacing,
				margin: raw.margin,
			});
		} else {
			screenshotTasks.push({ raw, id, clip });
		}
	}

	const chunkResults = await processElementChunk({
		page,
		tasks: screenshotTasks,
		textureStore,
		pageName,
		viewport,
	});

	await page.close();

	for (const [idx, element] of chunkResults) {
		elementsByIdx.set(idx, element);
	}

	if (elementsByIdx.size === 0) {
		console.log(`[ui-html] ${pageName}: no renderable elements found.`);
		return;
	}

	const roots: GeneratedElement[] = [];
	for (const [idx, element] of elementsByIdx.entries()) {
		let parentIdx = rawByIdx.get(idx)?.parentIdx ?? null;
		while (parentIdx !== null) {
			const parentElement = elementsByIdx.get(parentIdx);
			if (!parentElement) {
				parentIdx = rawByIdx.get(parentIdx)?.parentIdx ?? null;
				continue;
			}
			if (parentElement.isLabel) {
				parentIdx = rawByIdx.get(parentIdx)?.parentIdx ?? null;
				continue;
			}
			break;
		}

		if (parentIdx !== null) {
			elementsByIdx.get(parentIdx)?.children.push(element);
		} else {
			roots.push(element);
		}
	}

	const sortElements = (nodes: GeneratedElement[]): void => {
		nodes.sort((a, b) => a.zIndex - b.zIndex || a.order - b.order);
		for (const node of nodes) {
			if (node.children.length > 0) {
				sortElements(node.children);
			}
		}
	};

	sortElements(roots);

	const flatElements = flattenElements(roots);

	await fsp.mkdir(uiOutputDir, { recursive: true });
	const uiPath = path.join(uiOutputDir, `${pageSlug}.ui`);
	const ui = buildUiFile(roots, viewport, hasSceneBlur);
	await fsp.writeFile(uiPath, ui, "utf8");

	await fsp.mkdir(htmlOutputDir, { recursive: true });
	const previewPath = path.join(htmlOutputDir, `${pageSlug}.html`);
	const previewHtml = buildPreviewHtml({
		pageName: pageClass,
		viewport,
		elements: flatElements,
		outputPath: previewPath,
	});
	await fsp.writeFile(previewPath, previewHtml, "utf8");

	console.log(`[ui-html] ${pageName}: generated ${flatElements.length} elements.`);
}
