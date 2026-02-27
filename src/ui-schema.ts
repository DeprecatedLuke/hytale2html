export type ScalarValueType = "boolean" | "integer" | "float" | "string" | "color" | "uiPath";

export type ValueSchema =
	| { kind: "any" }
	| { kind: "scalar"; scalar: ScalarValueType }
	| { kind: "enum"; enumName: string; values: readonly string[] }
	| { kind: "object"; objectType: string }
	| { kind: "union"; variants: readonly ValueSchema[] };

export type PropertySchema = {
	type: ValueSchema;
	docsType: string;
};

export type ObjectSchema = {
	fields: Readonly<Record<string, PropertySchema>>;
};

export type ElementSchema = {
	properties: Readonly<Record<string, PropertySchema>>;
};

const anyValue = (): ValueSchema => ({ kind: "any" });
const scalar = (scalarType: ScalarValueType): ValueSchema => ({ kind: "scalar", scalar: scalarType });
const enumValue = (enumName: string, values: readonly string[]): ValueSchema => ({ kind: "enum", enumName, values });
const objectValue = (objectType: string): ValueSchema => ({ kind: "object", objectType });
const unionValue = (...variants: ValueSchema[]): ValueSchema => ({ kind: "union", variants });
const property = (type: ValueSchema, docsType: string): PropertySchema => ({ type, docsType });

export const UI_ENUMS = {
	LayoutMode: [
		"Full",
		"Left",
		"Center",
		"Right",
		"Top",
		"Middle",
		"Bottom",
		"LeftScrolling",
		"RightScrolling",
		"TopScrolling",
		"BottomScrolling",
		"CenterMiddle",
		"MiddleCenter",
		"LeftCenterWrap",
	],
	LabelAlignment: ["Start", "Center", "End"],
	MouseWheelScrollBehaviourType: ["Default", "VerticalOnly", "HorizontalOnly"],
} as const;

const backgroundValue = unionValue(objectValue("PatchStyle"), scalar("color"), scalar("uiPath"), scalar("string"));

export const OBJECT_SCHEMAS: Readonly<Record<string, ObjectSchema>> = {
	Anchor: {
		fields: {
			Left: property(scalar("integer"), "Integer"),
			Right: property(scalar("integer"), "Integer"),
			Top: property(scalar("integer"), "Integer"),
			Bottom: property(scalar("integer"), "Integer"),
			Height: property(scalar("integer"), "Integer"),
			Full: property(scalar("integer"), "Integer"),
			Horizontal: property(scalar("integer"), "Integer"),
			Vertical: property(scalar("integer"), "Integer"),
			Width: property(scalar("integer"), "Integer"),
			MinWidth: property(scalar("integer"), "Integer"),
			MaxWidth: property(scalar("integer"), "Integer"),
		},
	},
	Padding: {
		fields: {
			Left: property(scalar("integer"), "Integer"),
			Right: property(scalar("integer"), "Integer"),
			Top: property(scalar("integer"), "Integer"),
			Bottom: property(scalar("integer"), "Integer"),
			Full: property(scalar("integer"), "Integer"),
			Horizontal: property(scalar("integer"), "Integer"),
			Vertical: property(scalar("integer"), "Integer"),
		},
	},
	PatchStyle: {
		fields: {
			Area: property(objectValue("Padding"), "Padding"),
			Color: property(scalar("color"), "Color"),
			Anchor: property(objectValue("Anchor"), "Anchor"),
			HorizontalBorder: property(scalar("integer"), "Integer"),
			VerticalBorder: property(scalar("integer"), "Integer"),
			TexturePath: property(scalar("uiPath"), "UI Path (String)"),
			Border: property(scalar("integer"), "Integer"),
		},
	},
	ButtonStyleState: {
		fields: {
			Background: property(backgroundValue, "PatchStyle / String"),
		},
	},
	ButtonStyle: {
		fields: {
			Default: property(objectValue("ButtonStyleState"), "ButtonStyleState"),
			Hovered: property(objectValue("ButtonStyleState"), "ButtonStyleState"),
			Pressed: property(objectValue("ButtonStyleState"), "ButtonStyleState"),
			Disabled: property(objectValue("ButtonStyleState"), "ButtonStyleState"),
			Sounds: property(anyValue(), "ButtonSounds"),
		},
	},
	LabelStyle: {
		fields: {
			HorizontalAlignment: property(enumValue("LabelAlignment", UI_ENUMS.LabelAlignment), "LabelAlignment"),
			VerticalAlignment: property(enumValue("LabelAlignment", UI_ENUMS.LabelAlignment), "LabelAlignment"),
			Wrap: property(scalar("boolean"), "Boolean"),
			FontName: property(scalar("string"), "Font Name (String)"),
			FontSize: property(scalar("float"), "Float"),
			TextColor: property(scalar("color"), "Color"),
			OutlineColor: property(scalar("color"), "Color"),
			LetterSpacing: property(scalar("float"), "Float"),
			RenderUppercase: property(scalar("boolean"), "Boolean"),
			RenderBold: property(scalar("boolean"), "Boolean"),
			RenderItalics: property(scalar("boolean"), "Boolean"),
			RenderUnderlined: property(scalar("boolean"), "Boolean"),
			Alignment: property(enumValue("LabelAlignment", UI_ENUMS.LabelAlignment), "LabelAlignment"),
		},
	},
};

const commonElementProperties: Readonly<Record<string, PropertySchema>> = {
	Visible: property(scalar("boolean"), "Boolean"),
	HitTestVisible: property(scalar("boolean"), "Boolean"),
	TooltipText: property(scalar("string"), "String"),
	TooltipTextSpans: property(anyValue(), "List<LabelSpan>"),
	TextTooltipStyle: property(anyValue(), "TextTooltipStyle"),
	TextTooltipShowDelay: property(scalar("float"), "Float"),
	Anchor: property(objectValue("Anchor"), "Anchor"),
	Padding: property(objectValue("Padding"), "Padding"),
	FlexWeight: property(scalar("integer"), "Integer"),
	ContentWidth: property(scalar("integer"), "Integer"),
	ContentHeight: property(scalar("integer"), "Integer"),
	AutoScrollDown: property(scalar("boolean"), "Boolean"),
	KeepScrollPosition: property(scalar("boolean"), "Boolean"),
	MouseWheelScrollBehaviour: property(
		enumValue("MouseWheelScrollBehaviourType", UI_ENUMS.MouseWheelScrollBehaviourType),
		"MouseWheelScrollBehaviourType",
	),
	Background: property(backgroundValue, "PatchStyle / String"),
	MaskTexturePath: property(scalar("uiPath"), "UI Path (String)"),
	OutlineColor: property(scalar("color"), "Color"),
	OutlineSize: property(scalar("float"), "Float"),
	Overscroll: property(scalar("boolean"), "Boolean"),
};

export const ELEMENT_SCHEMAS: Readonly<Record<string, ElementSchema>> = {
	Group: {
		properties: {
			LayoutMode: property(enumValue("LayoutMode", UI_ENUMS.LayoutMode), "LayoutMode"),
			ScrollbarStyle: property(anyValue(), "ScrollbarStyle"),
			...commonElementProperties,
		},
	},
	Button: {
		properties: {
			LayoutMode: property(enumValue("LayoutMode", UI_ENUMS.LayoutMode), "LayoutMode"),
			Disabled: property(scalar("boolean"), "Boolean"),
			Style: property(objectValue("ButtonStyle"), "ButtonStyle"),
			...commonElementProperties,
		},
	},
	Label: {
		properties: {
			Text: property(scalar("string"), "String"),
			TextSpans: property(anyValue(), "List<LabelSpan>"),
			Style: property(objectValue("LabelStyle"), "LabelStyle"),
			...commonElementProperties,
		},
	},
	SceneBlur: {
		properties: {
			...commonElementProperties,
		},
	},
};

export const OFFICIAL_UI_ELEMENTS = [
	"ActionButton",
	"AssetImage",
	"BackButton",
	"BlockSelector",
	"Button",
	"CharacterPreviewComponent",
	"CheckBox",
	"CheckBoxContainer",
	"CircularProgressBar",
	"CodeEditor",
	"ColorOptionGrid",
	"ColorPicker",
	"ColorPickerDropdownBox",
	"CompactTextField",
	"DropdownBox",
	"DropdownEntry",
	"DynamicPane",
	"DynamicPaneContainer",
	"FloatSlider",
	"FloatSliderNumberField",
	"Group",
	"HotkeyLabel",
	"ItemGrid",
	"ItemIcon",
	"ItemPreviewComponent",
	"ItemSlot",
	"ItemSlotButton",
	"Label",
	"LabeledCheckBox",
	"MenuItem",
	"MultilineTextField",
	"NumberField",
	"Panel",
	"ProgressBar",
	"ReorderableList",
	"ReorderableListGrip",
	"SceneBlur",
	"Slider",
	"SliderNumberField",
	"Sprite",
	"TabButton",
	"TabNavigation",
	"TextButton",
	"TextField",
	"TimerLabel",
	"ToggleButton",
] as const;

export const OFFICIAL_UI_ELEMENT_SET = new Set<string>(OFFICIAL_UI_ELEMENTS);

export const UI_SCHEMA = {
	elements: ELEMENT_SCHEMAS,
	objectTypes: OBJECT_SCHEMAS,
	enums: UI_ENUMS,
	officialElements: OFFICIAL_UI_ELEMENT_SET,
} as const;
