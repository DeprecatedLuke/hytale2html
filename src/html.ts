import path from "node:path";

import postcss from "postcss";
import tailwindcss from "tailwindcss";

import type { GeneratedElement, LabelStyle, Viewport } from "./types.js";
import { escapeHtml, uiColorToCss } from "./utils.js";

export function injectStyle(html: string, css: string, baseHref: string): string {
	const styleTag = `<style>${css}</style>`;
	const baseTag = `<base href="${baseHref}">`;

	if (/<head[^>]*>/i.test(html)) {
		return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${styleTag}`);
	}

	if (/<html[^>]*>/i.test(html)) {
		return html.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}${styleTag}</head>`);
	}

	return `<!DOCTYPE html><html><head>${baseTag}${styleTag}</head><body>${html}</body></html>`;
}

export async function compileTailwind(configPath: string, inputDir: string): Promise<string> {
	const cssInput = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nhtml, body { margin: 0; padding: 0; width: 100%; height: 100%; }\n* { box-sizing: border-box; }\n`;
	const cwd = process.cwd();
	try {
		process.chdir(inputDir);
		const result = await postcss([tailwindcss({ config: configPath })]).process(cssInput, {
			from: undefined,
		});
		return result.css;
	} finally {
		process.chdir(cwd);
	}
}

export function buildPreviewHtml(params: {
	pageName: string;
	viewport: Viewport;
	elements: GeneratedElement[];
	outputPath: string;
}): string {
	const { pageName, viewport, elements, outputPath } = params;
	const baseDir = path.dirname(outputPath);
	const toRelative = (filePath: string) => path.relative(baseDir, filePath).split(path.sep).join("/");
	const labelStyleToCss = (style: LabelStyle | null) => {
		if (!style) return "";
		const parts: string[] = [];
		if (style.fontSize !== undefined) parts.push(`font-size:${style.fontSize}px`);
		if (style.textColor) parts.push(`color:${uiColorToCss(style.textColor)}`);
		if (style.bold) parts.push("font-weight:700");
		if (style.italic) parts.push("font-style:italic");
		if (style.uppercase) parts.push("text-transform:uppercase");
		if (style.letterSpacing !== undefined) parts.push(`letter-spacing:${style.letterSpacing}px`);
		if (style.align) {
			const align = style.align === "Center" ? "center" : style.align === "End" ? "right" : "left";
			parts.push(`text-align:${align}`);
		}
		if (style.wrap) {
			parts.push("white-space:normal");
		} else {
			parts.push("white-space:nowrap");
		}
		if (style.fontName) parts.push(`font-family:${style.fontName}`);
		return parts.join("; ");
	};
	const lines: string[] = [];
	const indent = (level: number) => " ".repeat(level * 2);

	lines.push("<!DOCTYPE html>");
	lines.push('<html lang="en">');
	lines.push(`${indent(1)}<head>`);
	lines.push(`${indent(2)}<meta charset="utf-8" />`);
	lines.push(`${indent(2)}<meta name="viewport" content="width=device-width, initial-scale=1" />`);
	lines.push(`${indent(2)}<title>${pageName} Preview</title>`);
	lines.push(`${indent(2)}<style>`);
	lines.push(`${indent(3)}html, body {`);
	lines.push(`${indent(4)}margin: 0;`);
	lines.push(`${indent(4)}padding: 0;`);
	lines.push(`${indent(4)}width: 100%;`);
	lines.push(`${indent(4)}height: 100%;`);
	lines.push(`${indent(4)}background: #0b0f17;`);
	lines.push(`${indent(3)}}`);
	lines.push(`${indent(3)}#root {`);
	lines.push(`${indent(4)}position: relative;`);
	lines.push(`${indent(4)}width: ${viewport.width}px;`);
	lines.push(`${indent(4)}height: ${viewport.height}px;`);
	lines.push(`${indent(4)}overflow: hidden;`);
	lines.push(`${indent(3)}}`);
	lines.push(`${indent(3)}.hy-el {`);
	lines.push(`${indent(4)}position: absolute;`);
	lines.push(`${indent(4)}transform-origin: top left;`);
	lines.push(`${indent(3)}}`);
	lines.push(`${indent(3)}.hy-label {`);
	lines.push(`${indent(4)}pointer-events: none;`);
	lines.push(`${indent(4)}display: flex;`);
	lines.push(`${indent(4)}align-items: center;`);
	lines.push(`${indent(3)}}`);
	lines.push(`${indent(3)}.hy-el img {`);
	lines.push(`${indent(4)}position: absolute;`);
	lines.push(`${indent(4)}left: 0;`);
	lines.push(`${indent(4)}top: 0;`);
	lines.push(`${indent(4)}width: 100%;`);
	lines.push(`${indent(4)}height: 100%;`);
	lines.push(`${indent(4)}user-select: none;`);
	lines.push(`${indent(4)}pointer-events: none;`);
	lines.push(`${indent(3)}}`);
	lines.push(`${indent(3)}.hy-el .state { opacity: 0; }`);
	lines.push(`${indent(3)}.hy-el .state.default { opacity: 1; }`);
	lines.push(`${indent(3)}.hy-button { cursor: pointer; }`);
	lines.push(`${indent(3)}.hy-el[data-has-hover="true"]:hover .state.default { opacity: 0; }`);
	lines.push(`${indent(3)}.hy-el[data-has-hover="true"]:hover .state.hover { opacity: 1; }`);
	lines.push(
		`${indent(3)}.hy-el[data-has-pressed="true"]:active .state.default, ` +
			`.hy-el[data-has-pressed="true"]:active .state.hover { opacity: 0; }`,
	);
	lines.push(`${indent(3)}.hy-el[data-has-pressed="true"]:active .state.pressed { opacity: 1; }`);
	lines.push(`${indent(3)}.hy-el[data-disabled="true"] { pointer-events: none; }`);
	lines.push(`${indent(3)}.hy-el[data-disabled="true"] .state { opacity: 0; }`);
	lines.push(`${indent(3)}.hy-el[data-disabled="true"] .state.disabled { opacity: 1; }`);
	lines.push(`${indent(3)}.hy-el[data-selected="true"] .state.selected { opacity: 1; }`);
	lines.push(`${indent(3)}.hy-el[data-focus="true"] .state.focus { opacity: 1; }`);
	lines.push(`${indent(2)}</style>`);
	lines.push(`${indent(1)}</head>`);
	lines.push(`${indent(1)}<body>`);
	lines.push(`${indent(2)}<div id="root">`);

	const stateOrder = ["default", "hover", "pressed", "disabled", "selected", "focus"];
	for (const element of elements) {
		const { x, y, width, height } = element.rect;
		const attrs: string[] = [];
		const classes = ["hy-el", element.isButton ? "hy-button" : null, element.isLabel ? "hy-label" : null]
			.filter(Boolean)
			.join(" ");
		const baseStyle = `left:${x}px; top:${y}px; width:${width}px; height:${height}px;`;

		if (element.isLabel) {
			const labelText = element.text ?? element.textBinding ?? "";
			const labelStyle = labelStyleToCss(element.labelStyle);
			attrs.push(`class="${classes}"`);
			attrs.push(`style="${baseStyle} ${labelStyle}"`);
			lines.push(`${indent(3)}<div ${attrs.join(" ")}>${escapeHtml(labelText)}</div>`);
			continue;
		}

		attrs.push(`class="${classes}"`);
		attrs.push(`style="${baseStyle}"`);
		if (element.files.hover) attrs.push('data-has-hover="true"');
		if (element.files.pressed) attrs.push('data-has-pressed="true"');
		if (element.files.disabled) attrs.push('data-has-disabled="true"');
		const isDisabled = element.disabled || element.dataState === "disabled";
		if (isDisabled) attrs.push('data-disabled="true"');
		if (element.dataState === "selected") attrs.push('data-selected="true"');
		if (element.dataState === "focus") attrs.push('data-focus="true"');

		lines.push(`${indent(3)}<div ${attrs.join(" ")}>`);
		for (const state of stateOrder) {
			const filePath = element.files[state];
			if (!filePath) continue;
			const relative = toRelative(filePath);
			lines.push(`${indent(4)}<img class="state ${state}" src="${relative}" alt="${element.id}-${state}" />`);
		}
		lines.push(`${indent(3)}</div>`);
	}

	lines.push(`${indent(2)}</div>`);
	lines.push(`${indent(1)}</body>`);
	lines.push("</html>");
	lines.push("");
	return lines.join("\n");
}
