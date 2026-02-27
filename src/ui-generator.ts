import type { AnchorValues, GeneratedElement, Insets, LabelStyle, RawElement, Rect, Viewport } from "./types.js";
import { escapeUiString, formatUiNumber, hasInsets, parseCssColor, sumInsets, zeroInsets } from "./utils.js";

export function normalizeLayoutMode(value: string | null): string | null {
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
}

export function deriveAnchor(tokens: string[], rect: Rect, viewport: Viewport): AnchorValues {
	const normalized = tokens.map(token => token.trim().toLowerCase()).filter(Boolean);
	const tokenSet = new Set(normalized);
	let hasLeft = tokenSet.has("left");
	const hasRight = tokenSet.has("right");
	let hasTop = tokenSet.has("top");
	const hasBottom = tokenSet.has("bottom");
	const anchor: AnchorValues = {};

	if (!hasLeft && !hasRight) {
		hasLeft = true;
	}

	if (!hasTop && !hasBottom) {
		hasTop = true;
	}

	if (hasLeft) anchor.left = rect.x;
	if (hasRight) anchor.right = Math.max(0, viewport.width - (rect.x + rect.width));
	if (hasTop) anchor.top = rect.y;
	if (hasBottom) anchor.bottom = Math.max(0, viewport.height - (rect.y + rect.height));

	const forceWidth = tokenSet.has("width");
	const forceHeight = tokenSet.has("height");
	if (forceWidth || !(hasLeft && hasRight)) anchor.width = rect.width;
	if (forceHeight || !(hasTop && hasBottom)) anchor.height = rect.height;

	return anchor;
}

export function formatAnchor(anchor: AnchorValues): string {
	const parts: string[] = [];
	if (anchor.top !== undefined) parts.push(`Top: ${Math.round(anchor.top)}`);
	if (anchor.left !== undefined) parts.push(`Left: ${Math.round(anchor.left)}`);
	if (anchor.right !== undefined) parts.push(`Right: ${Math.round(anchor.right)}`);
	if (anchor.bottom !== undefined) parts.push(`Bottom: ${Math.round(anchor.bottom)}`);
	if (anchor.width !== undefined) parts.push(`Width: ${Math.round(anchor.width)}`);
	if (anchor.height !== undefined) parts.push(`Height: ${Math.round(anchor.height)}`);
	return `(${parts.join(", ")})`;
}

export function buildLabelStyle(raw: RawElement["textStyle"]): LabelStyle | null {
	if (!raw) return null;
	const style: LabelStyle = {};
	if (raw.fontSize > 0) style.fontSize = raw.fontSize;
	const color = parseCssColor(raw.color);
	if (color) style.textColor = color;

	const weightValue = Number.parseInt(raw.fontWeight, 10);
	if (raw.fontWeight === "bold" || raw.fontWeight === "bolder" || weightValue >= 600) {
		style.bold = true;
	}
	if (raw.fontStyle === "italic" || raw.fontStyle === "oblique") {
		style.italic = true;
	}
	if (raw.textTransform === "uppercase") {
		style.uppercase = true;
	}
	if (raw.textDecoration?.includes("underline")) {
		style.underline = true;
	}
	if (raw.letterSpacing !== 0) {
		style.letterSpacing = raw.letterSpacing;
	}
	const align = raw.textAlign;
	if (align === "center") style.align = "Center";
	else if (align === "right" || align === "end") style.align = "End";
	else if (align === "left" || align === "start") style.align = "Start";

	const valign = raw.verticalAlign;
	if (valign === "middle") style.valign = "Center";
	else if (valign === "bottom") style.valign = "End";
	else if (valign === "top") style.valign = "Start";

	if (raw.whiteSpace && raw.whiteSpace !== "nowrap") {
		style.wrap = true;
	}
	if (raw.fontName) style.fontName = raw.fontName;
	if (raw.maxLines !== null && raw.maxLines > 0) style.maxLines = raw.maxLines;

	return Object.keys(style).length > 0 ? style : null;
}

export function buildUiFile(elements: GeneratedElement[], viewport: Viewport, hasSceneBlur: boolean): string {
	const lines: string[] = [];
	const indent = (level: number) => " ".repeat(level * 2);

	const appendAnchor = (level: number, anchorValues: AnchorValues) => {
		lines.push(`${indent(level)}Anchor: ${formatAnchor(anchorValues)};`);
	};
	const appendPadding = (level: number, insets: Insets) => {
		if (!hasInsets(insets)) return;
		if (insets.top === insets.right && insets.top === insets.bottom && insets.top === insets.left) {
			lines.push(`${indent(level)}Padding: (Full: ${insets.top});`);
			return;
		}
		const parts: string[] = [];
		if (insets.top !== 0) parts.push(`Top: ${insets.top}`);
		if (insets.right !== 0) parts.push(`Right: ${insets.right}`);
		if (insets.bottom !== 0) parts.push(`Bottom: ${insets.bottom}`);
		if (insets.left !== 0) parts.push(`Left: ${insets.left}`);
		lines.push(`${indent(level)}Padding: (${parts.join(", ")});`);
	};

	const appendCommonProperties = (params: {
		level: number;
		element: GeneratedElement;
		includeMask?: boolean;
		includeDisabled?: boolean;
	}) => {
		const { level, element, includeMask = true, includeDisabled = false } = params;
		if (element.hidden) {
			lines.push(`${indent(level)}Visible: false;`);
		}
		if (element.flexWeight !== null) {
			lines.push(`${indent(level)}FlexWeight: ${formatUiNumber(element.flexWeight)};`);
		}
		if (includeDisabled && (element.disabled || element.dataState === "disabled")) {
			lines.push(`${indent(level)}Disabled: true;`);
		}
		if (element.tooltip) {
			lines.push(`${indent(level)}TooltipText: "${escapeUiString(element.tooltip)}";`);
		}
		if (element.hitTestVisible) {
			lines.push(`${indent(level)}HitTestVisible: true;`);
		}
		if (element.outline) {
			lines.push(`${indent(level)}OutlineSize: ${formatUiNumber(element.outline.size)};`);
			lines.push(`${indent(level)}OutlineColor: ${element.outline.color};`);
		}
		if (includeMask && element.mask) {
			lines.push(`${indent(level)}MaskTexturePath: "${escapeUiString(element.mask)}";`);
		}
	};

	const appendSpacer = (level: number, vertical: boolean, size: number) => {
		const anchor = vertical ? `(Height: ${size})` : `(Width: ${size})`;
		lines.push(`${indent(level)}Group {`);
		lines.push(`${indent(level + 1)}Anchor: ${anchor};`);
		lines.push(`${indent(level)}}`);
	};
	const isVerticalLayout = (mode: string | null): boolean => {
		if (!mode) return false;
		return ["Top", "Bottom", "Middle", "MiddleCenter", "TopScrolling", "BottomScrolling"].includes(mode);
	};
	const buildChildrenWithSpacing = (
		children: GeneratedElement[],
		parentRect: Rect,
		parentInsets: Insets,
		level: number,
		layoutMode: string | null,
		spacing: number,
		insideButton: boolean,
	) => {
		const vertical = isVerticalLayout(layoutMode);
		const effectiveSpacing = insideButton ? 0 : spacing;
		for (let i = 0; i < children.length; i += 1) {
			buildElement(children[i]!, parentRect, parentInsets, level, layoutMode, insideButton);
			if (effectiveSpacing > 0 && i < children.length - 1) {
				appendSpacer(level, vertical, effectiveSpacing);
			}
		}
	};
	const buildElement = (
		element: GeneratedElement,
		parentRect: Rect,
		parentInsets: Insets,
		level: number,
		parentLayoutMode: string | null,
		insideButton: boolean = false,
	) => {
		const contentInsets = sumInsets(element.padding, element.border);
		const containerWidth = Math.max(0, parentRect.width - parentInsets.left - parentInsets.right);
		const containerHeight = Math.max(0, parentRect.height - parentInsets.top - parentInsets.bottom);
		const relativeRect = {
			x: element.rect.x - parentRect.x - parentInsets.left,
			y: element.rect.y - parentRect.y - parentInsets.top,
			width: element.rect.width,
			height: element.rect.height,
		};
		const useLayoutAnchor =
			parentLayoutMode !== null &&
			parentLayoutMode !== "none" &&
			element.anchorTokens.length === 0 &&
			element.layoutMode !== "none";
		const anchorValues = useLayoutAnchor
			? { width: relativeRect.width, height: relativeRect.height }
			: deriveAnchor(element.anchorTokens, relativeRect, { width: containerWidth, height: containerHeight });
		const hasChildren = element.children.length > 0;
		if (element.isLabel) {
			lines.push(`${indent(level)}Label #${element.id} {`);
			appendAnchor(level + 1, anchorValues);
			if (element.textBinding) {
				lines.push(`${indent(level + 1)}Text: ${element.textBinding};`);
			} else if (element.text !== null) {
				lines.push(`${indent(level + 1)}Text: "${escapeUiString(element.text)}";`);
			}
			if (element.labelStyle) {
				const styleParts: string[] = [];
				if (element.labelStyle.fontSize !== undefined)
					styleParts.push(`FontSize: ${formatUiNumber(element.labelStyle.fontSize)}`);
				if (element.labelStyle.textColor) styleParts.push(`TextColor: ${element.labelStyle.textColor}`);
				if (element.labelStyle.bold) styleParts.push("RenderBold: true");
				if (element.labelStyle.italic) styleParts.push("RenderItalics: true");
				if (element.labelStyle.uppercase) styleParts.push("RenderUppercase: true");
				if (element.labelStyle.underline) styleParts.push("RenderUnderlined: true");
				if (element.labelStyle.wrap) styleParts.push("Wrap: true");
				if (element.labelStyle.fontName)
					styleParts.push(`FontName: "${escapeUiString(element.labelStyle.fontName)}"`);
				if (element.labelStyle.letterSpacing !== undefined)
					styleParts.push(`LetterSpacing: ${formatUiNumber(element.labelStyle.letterSpacing)}`);
				if (element.labelStyle.align) styleParts.push(`HorizontalAlignment: ${element.labelStyle.align}`);
				if (element.labelStyle.valign) styleParts.push(`VerticalAlignment: ${element.labelStyle.valign}`);
				if (styleParts.length > 0) {
					lines.push(`${indent(level + 1)}Style: (${styleParts.join(", ")});`);
				}
			}
			appendCommonProperties({ level: level + 1, element });
			lines.push(`${indent(level)}}`);
			return;
		}

		const shouldUseGroup = !element.isButton && hasChildren;
		if (element.isButton) {
			lines.push(`${indent(level)}Button #${element.id} {`);
			appendAnchor(level + 1, anchorValues);
			if (hasChildren) {
				appendPadding(level + 1, contentInsets);
			}
			const stateParts = [`Default: (Background: "${escapeUiString(element.textures.default!)}")`];
			if (element.textures.hover) {
				stateParts.push(`Hovered: (Background: "${escapeUiString(element.textures.hover)}")`);
			}
			if (element.textures.pressed) {
				stateParts.push(`Pressed: (Background: "${escapeUiString(element.textures.pressed)}")`);
			}
			if (element.textures.disabled) {
				stateParts.push(`Disabled: (Background: "${escapeUiString(element.textures.disabled)}")`);
			}
			lines.push(`${indent(level + 1)}Style: ButtonStyle(${stateParts.join(", ")});`);
			appendCommonProperties({ level: level + 1, element, includeDisabled: true });
			if (hasChildren) {
				buildChildrenWithSpacing(
					element.children,
					element.rect,
					contentInsets,
					level + 1,
					null,
					element.spacing,
					true,
				);
			}
			lines.push(`${indent(level)}}`);
		} else if (shouldUseGroup) {
			lines.push(`${indent(level)}Group #${element.id} {`);
			appendAnchor(level + 1, anchorValues);
			const hasAbsoluteChild = element.children.some(c => c.layoutMode === "none");
			const effectiveLayoutMode = hasAbsoluteChild ? null : element.layoutMode;
			if (effectiveLayoutMode && effectiveLayoutMode !== "none" && hasChildren) {
				lines.push(`${indent(level + 1)}LayoutMode: ${effectiveLayoutMode};`);
			}
			appendPadding(level + 1, contentInsets);
			lines.push(`${indent(level + 1)}Background: "${escapeUiString(element.textures.default!)}";`);
			appendCommonProperties({ level: level + 1, element });
			buildChildrenWithSpacing(
				element.children,
				element.rect,
				contentInsets,
				level + 1,
				effectiveLayoutMode,
				effectiveLayoutMode ? element.spacing : 0,
				insideButton,
			);
			lines.push(`${indent(level)}}`);
		} else {
			lines.push(`${indent(level)}Group #${element.id} {`);
			appendAnchor(level + 1, anchorValues);
			lines.push(`${indent(level + 1)}Background: "${escapeUiString(element.textures.default!)}";`);
			appendCommonProperties({ level: level + 1, element });
			lines.push(`${indent(level)}}`);
		}
		if (element.selectedTexture) {
			lines.push(`${indent(level)}Group #${element.id}Selected {`);
			appendAnchor(level + 1, anchorValues);
			lines.push(`${indent(level + 1)}Background: "${escapeUiString(element.selectedTexture)}";`);
			lines.push(`${indent(level + 1)}Visible: false;`);
			lines.push(`${indent(level)}}`);
		}
		if (element.focusTexture) {
			lines.push(`${indent(level)}Group #${element.id}Focus {`);
			appendAnchor(level + 1, anchorValues);
			lines.push(`${indent(level + 1)}Background: "${escapeUiString(element.focusTexture)}";`);
			lines.push(`${indent(level + 1)}Visible: false;`);
			lines.push(`${indent(level)}}`);
		}
	};
	if (hasSceneBlur) {
		lines.push("SceneBlur {}");
	}
	lines.push("Group #Root {");
	lines.push(`${indent(1)}Anchor: (Full: 0);`);
	const rootRect: Rect = { x: 0, y: 0, width: viewport.width, height: viewport.height };
	const rootInsets = zeroInsets();
	for (const element of elements) {
		buildElement(element, rootRect, rootInsets, 1, null);
	}
	lines.push("}");
	lines.push("");
	return lines.join("\n");
}
