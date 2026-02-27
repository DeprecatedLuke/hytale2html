export type Viewport = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Insets = { top: number; right: number; bottom: number; left: number };
export type LabelStyle = {
	fontSize?: number;
	textColor?: string;
	bold?: boolean;
	italic?: boolean;
	uppercase?: boolean;
	underline?: boolean;
	letterSpacing?: number;
	align?: "Start" | "Center" | "End";
	valign?: "Start" | "Center" | "End";
	wrap?: boolean;
	fontName?: string;
	maxLines?: number;
};

export type AnchorValues = {
	top?: number;
	left?: number;
	right?: number;
	bottom?: number;
	width?: number;
	height?: number;
};

export type RawElement = {
	idx: number;
	rawId: string;
	tag: string;
	dataState: string | null;
	disabled: boolean;
	rect: Rect;
	zIndex: number;
	isButton: boolean;
	order: number;
	anchorTokens: string[];
	parentIdx: number | null;
	padding: Insets;
	border: Insets;
	layoutMode: string | null;
	flexWeight: number | null;
	isLabel: boolean;
	text: string | null;
	textBinding: string | null;
	textStyle: {
		fontSize: number;
		color: string;
		fontWeight: string;
		fontStyle: string;
		textTransform: string;
		textDecoration: string;
		letterSpacing: number;
		textAlign: string;
		verticalAlign: string;
		whiteSpace: string;
		fontName: string | null;
		maxLines: number | null;
	} | null;
	skipRender: boolean;
	useBackdrop: boolean;
	bleed: number;
	hasText: boolean;
	hidden: boolean;
	clipChildren: boolean;
	tooltip: string | null;
	outline: { size: number; color: string } | null;
	hitTestVisible: boolean;
	mask: string | null;
	spacing: number;
	margin: Insets;
};

export type GeneratedElement = {
	id: string;
	rect: Rect;
	anchorTokens: string[];
	padding: Insets;
	border: Insets;
	isButton: boolean;
	textures: Record<string, string>;
	files: Record<string, string>;
	dataState: string | null;
	disabled: boolean;
	selectedTexture?: string;
	focusTexture?: string;
	children: GeneratedElement[];
	zIndex: number;
	order: number;
	layoutMode: string | null;
	flexWeight: number | null;
	isLabel: boolean;
	text: string | null;
	textBinding: string | null;
	labelStyle: LabelStyle | null;
	hidden: boolean;
	clipChildren: boolean;
	tooltip: string | null;
	outline: { size: number; color: string } | null;
	hitTestVisible: boolean;
	mask: string | null;
	spacing: number;
	margin: Insets;
};

export type Args = {
	input: string;
	outResources: string;
	outUi: string;
	outHtml: string;
	viewport: Viewport;
	namespace: string;
	check: boolean;
	strictValidate: boolean;
	force: boolean;
};

export type DecodedPng = { width: number; height: number; data: Buffer };

export type SharedTextureInfo = {
	key: string; // e.g. t<sha256>
	width: number;
	height: number;
	fingerprint: string;
	filePath: string; // absolute path to @2x
	texturePath: string; // path without @2x (what generated UI references)
};

export type ElementTask = {
	raw: RawElement;
	id: string;
	clip: Rect;
};
