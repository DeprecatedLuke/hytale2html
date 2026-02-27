import fs from "node:fs";
import path from "node:path";
import type * as puppeteer from "puppeteer-core";

import type { Rect } from "./types.js";

export async function waitForFonts(page: puppeteer.Page, timeoutMs: number): Promise<void> {
	await page.evaluate(async timeout => {
		if (!document.fonts?.ready) return;
		await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, timeout))]);
	}, timeoutMs);
}

export function resolveChromePath(): string {
	const platformCandidates =
		process.platform === "win32"
			? [
					path.join("C:\\", "Program Files", "Google", "Chrome", "Application", "chrome.exe"),
					path.join("C:\\", "Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
					process.env.LOCALAPPDATA
						? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
						: undefined,
					process.env.LOCALAPPDATA
						? path.join(process.env.LOCALAPPDATA, "Chromium", "Application", "chrome.exe")
						: undefined,
				]
			: ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/opt/google/chrome/chrome"];

	const candidates = [process.env.CHROME_PATH, ...platformCandidates].filter(Boolean) as string[];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}

	throw new Error(
		"Chrome/Chromium executable not found. Set CHROME_PATH or install Google Chrome/Chromium (Windows) or google-chrome-stable (Linux).",
	);
}

export async function prepareElement(
	page: puppeteer.Page,
	handle: puppeteer.ElementHandle<Element>,
	keepBackdrop: boolean,
): Promise<void> {
	await page.evaluate(
		(element, allowBackdrop) => {
			// Kill all CSS transitions so visibility:hidden takes effect immediately
			let killSheet = document.getElementById("hy-kill-transitions") as HTMLStyleElement | null;
			if (!killSheet) {
				killSheet = document.createElement("style");
				killSheet.id = "hy-kill-transitions";
				killSheet.textContent = "* { transition: none !important; }";
				document.head.appendChild(killSheet);
			}
			// hideOtherElements
			const attr = "data-hy-prev-visibility-other";
			document.body.querySelectorAll("*").forEach(child => {
				if (child === element) return;
				if (element.contains(child)) return;
				if (child.contains(element)) return;
				if (allowBackdrop && child.closest("[data-hy-backdrop]")) return;
				if (!child.hasAttribute(attr)) {
					child.setAttribute(attr, (child as HTMLElement).style.visibility || "");
				}
				(child as HTMLElement).style.visibility = "hidden";
			});
			// hideDescendants
			element.querySelectorAll("[data-hy-idx]").forEach(child => {
				if (!child.hasAttribute("data-hy-prev-visibility")) {
					child.setAttribute("data-hy-prev-visibility", (child as HTMLElement).style.visibility || "");
				}
				(child as HTMLElement).style.visibility = "hidden";
			});
			// clearAncestorBackgrounds
			const bgAttr = "data-hy-prev-background-style";
			let parent = element.parentElement;
			while (parent) {
				if (!parent.hasAttribute(bgAttr)) {
					parent.setAttribute(bgAttr, parent.getAttribute("style") ?? "");
				}
				parent.style.background = "transparent";
				parent.style.backgroundColor = "transparent";
				parent.style.backgroundImage = "none";
				parent = parent.parentElement;
			}
		},
		handle,
		keepBackdrop,
	);
}

export async function restoreElement(page: puppeteer.Page, handle: puppeteer.ElementHandle<Element>): Promise<void> {
	await page.evaluate(element => {
		// restoreAncestorBackgrounds
		const bgAttr = "data-hy-prev-background-style";
		document.querySelectorAll(`[${bgAttr}]`).forEach(child => {
			const prev = child.getAttribute(bgAttr);
			if (prev === null || prev === "") {
				child.removeAttribute("style");
			} else {
				child.setAttribute("style", prev);
			}
			child.removeAttribute(bgAttr);
		});
		// restoreDescendants
		element.querySelectorAll("[data-hy-prev-visibility]").forEach(child => {
			const prev = child.getAttribute("data-hy-prev-visibility");
			if (prev === null || prev === "") {
				(child as HTMLElement).style.removeProperty("visibility");
			} else {
				(child as HTMLElement).style.visibility = prev;
			}
			child.removeAttribute("data-hy-prev-visibility");
		});
		// restoreHiddenElements
		const attr = "data-hy-prev-visibility-other";
		document.body.querySelectorAll(`[${attr}]`).forEach(child => {
			const prev = child.getAttribute(attr);
			if (prev === null || prev === "") {
				(child as HTMLElement).style.removeProperty("visibility");
			} else {
				(child as HTMLElement).style.visibility = prev;
			}
			child.removeAttribute(attr);
		});
		// Remove transition kill sheet
		document.getElementById("hy-kill-transitions")?.remove();
	}, handle);
}

export async function applyState(
	page: puppeteer.Page,
	handle: puppeteer.ElementHandle<Element>,
	state: string | null,
): Promise<{ dataState: string | null; disabled: boolean; ariaDisabled: string | null }> {
	return await page.evaluate(
		(element, nextState) => {
			const prev = {
				dataState: element.getAttribute("data-state"),
				disabled: element.hasAttribute("disabled"),
				ariaDisabled: element.getAttribute("aria-disabled"),
			};

			if (nextState) {
				element.setAttribute("data-state", nextState);
			} else {
				element.removeAttribute("data-state");
			}

			if (nextState === "disabled") {
				element.setAttribute("disabled", "");
				element.setAttribute("aria-disabled", "true");
			} else if (!prev.disabled) {
				element.removeAttribute("disabled");
				if (prev.ariaDisabled === null) {
					element.removeAttribute("aria-disabled");
				}
			}

			return prev;
		},
		handle,
		state,
	);
}

export async function restoreState(
	page: puppeteer.Page,
	handle: puppeteer.ElementHandle<Element>,
	prev: { dataState: string | null; disabled: boolean; ariaDisabled: string | null },
): Promise<void> {
	await page.evaluate(
		(element, previous) => {
			if (previous.dataState === null) {
				element.removeAttribute("data-state");
			} else {
				element.setAttribute("data-state", previous.dataState);
			}

			if (previous.disabled) {
				element.setAttribute("disabled", "");
			} else {
				element.removeAttribute("disabled");
			}

			if (previous.ariaDisabled === null) {
				element.removeAttribute("aria-disabled");
			} else {
				element.setAttribute("aria-disabled", previous.ariaDisabled);
			}
		},
		handle,
		prev,
	);
}

export async function captureElementStateBuffer(params: {
	page: puppeteer.Page;
	handle: puppeteer.ElementHandle<Element>;
	clip: Rect;
	state: string;
}): Promise<Buffer> {
	const { page, handle, clip, state } = params;
	const stateAttr = ["disabled", "selected", "focus"].includes(state) ? state : null;
	const prevState = await applyState(page, handle, stateAttr);
	try {
		if (state === "hover" || state === "pressed") {
			await handle.hover();
		}
		if (state === "pressed") {
			await page.mouse.down();
		}
		if (state === "focus") {
			await handle.focus();
		}

		return (await page.screenshot({ clip, omitBackground: true, optimizeForSpeed: true })) as Buffer;
	} finally {
		if (state === "pressed") {
			await page.mouse.up();
		}
		if (state === "focus") {
			await page.evaluate(element => (element as HTMLElement).blur(), handle);
		}
		await restoreState(page, handle, prevState);
	}
}
