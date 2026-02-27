import { promises as fsp } from "node:fs";
import path from "node:path";

import { type PropertySchema, type ScalarValueType, UI_SCHEMA, type ValueSchema } from "./ui-schema.js";

export type ValidationIssue = {
	file: string;
	line: number;
	column: number;
	code: "unknown-element" | "unknown-property" | "invalid-value" | "syntax";
	element?: string;
	property?: string;
	message: string;
};

export type ValidationResult = {
	file: string;
	issues: ValidationIssue[];
};

type ElementFrame = {
	type: string;
	line: number;
};

type PendingProperty = {
	elementType: string;
	propertyName: string;
	line: number;
	column: number;
	rawValue: string;
};

type ObjectField = {
	name: string;
	value: string;
};

type ParsedObjectValue = {
	typeName: string | null;
	fields: ObjectField[];
};

type ValidationProblem = {
	message: string;
};

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
const STRING_LITERAL_PATTERN = /^"(?:\\.|[^"\\])*"$/;
const INTEGER_PATTERN = /^-?\d+$/;
const FLOAT_PATTERN = /^-?\d+(?:\.\d+)?$/;
const TRANSLATION_PATTERN = /^%[A-Za-z0-9_.-]+$/;
const REFERENCE_PATTERN = /^[@$%][A-Za-z0-9_.@]+$/;
const BARE_STRING_PATTERN = /^[A-Za-z_][A-Za-z0-9_.[\]]*$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}(?:\((?:0(?:\.\d+)?|1(?:\.0+)?)\)|[0-9a-fA-F]{2})?$/;

export function validateUiDocument(source: string, filePath: string = "<inline>"): ValidationResult {
	const issues: ValidationIssue[] = [];
	const lines = source.split(/\r?\n/);
	const stack: ElementFrame[] = [];
	let pending: PendingProperty | null = null;

	for (let index = 0; index < lines.length; index += 1) {
		const lineNumber = index + 1;
		const rawLine = lines[index] ?? "";
		const lineWithoutComments = stripInlineComments(rawLine);
		const trimmed = lineWithoutComments.trim();

		if (!trimmed) continue;

		if (pending) {
			pending.rawValue = `${pending.rawValue}\n${trimmed}`;
			const completed = takeUntilTopLevelSemicolon(pending.rawValue);
			if (!completed.complete) continue;
			validatePropertyValue({
				filePath,
				line: pending.line,
				column: pending.column,
				elementType: pending.elementType,
				propertyName: pending.propertyName,
				value: completed.value.trim(),
				issues,
			});
			pending = null;
			continue;
		}

		if (trimmed === "}") {
			if (stack.length === 0) {
				issues.push({
					file: filePath,
					line: lineNumber,
					column: 1,
					code: "syntax",
					message: "Unexpected closing brace without an open element.",
				});
			} else {
				stack.pop();
			}
			continue;
		}

		const selfClosingElement = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)\s*(?:#[A-Za-z][A-Za-z0-9_]*)?\s*\{\s*\}$/);
		if (selfClosingElement) {
			validateElementName(selfClosingElement[1]!, filePath, lineNumber, issues);
			continue;
		}

		const openingElement = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)\s*(?:#[A-Za-z][A-Za-z0-9_]*)?\s*\{$/);
		if (openingElement) {
			const elementType = openingElement[1]!;
			validateElementName(elementType, filePath, lineNumber, issues);
			stack.push({ type: elementType, line: lineNumber });
			continue;
		}

		const propertyMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*([\s\S]*)$/);
		if (propertyMatch && stack.length > 0) {
			const propertyName = propertyMatch[1]!;
			const valueChunk = propertyMatch[2]!;
			const completed = takeUntilTopLevelSemicolon(valueChunk);
			if (completed.complete) {
				validatePropertyValue({
					filePath,
					line: lineNumber,
					column: rawLine.indexOf(propertyName) + 1,
					elementType: stack[stack.length - 1]!.type,
					propertyName,
					value: completed.value.trim(),
					issues,
				});
			} else {
				pending = {
					elementType: stack[stack.length - 1]!.type,
					propertyName,
					line: lineNumber,
					column: rawLine.indexOf(propertyName) + 1,
					rawValue: valueChunk,
				};
			}
		}
	}

	if (pending) {
		issues.push({
			file: filePath,
			line: pending.line,
			column: pending.column,
			code: "syntax",
			element: pending.elementType,
			property: pending.propertyName,
			message: `Property ${pending.propertyName} is missing a terminating semicolon.`,
		});
	}

	if (stack.length > 0) {
		const unclosed = stack[stack.length - 1]!;
		issues.push({
			file: filePath,
			line: unclosed.line,
			column: 1,
			code: "syntax",
			element: unclosed.type,
			message: `Element ${unclosed.type} is not closed before end of file.`,
		});
	}

	return { file: filePath, issues };
}

export async function validateUiFile(filePath: string): Promise<ValidationResult> {
	const source = await fsp.readFile(filePath, "utf8");
	return validateUiDocument(source, filePath);
}

export function formatValidationIssue(issue: ValidationIssue): string {
	const scope: string[] = [];
	if (issue.element) scope.push(issue.element);
	if (issue.property) scope.push(issue.property);
	const context = scope.length > 0 ? ` (${scope.join(".")})` : "";
	return `${issue.file}:${issue.line}:${issue.column}${context} ${issue.message}`;
}

function validateElementName(elementType: string, filePath: string, line: number, issues: ValidationIssue[]): void {
	if (UI_SCHEMA.officialElements.has(elementType)) return;
	issues.push({
		file: filePath,
		line,
		column: 1,
		code: "unknown-element",
		element: elementType,
		message: `Unknown element type "${elementType}". This is not listed in the official Hytale Custom UI element docs.`,
	});
}

function validatePropertyValue(params: {
	filePath: string;
	line: number;
	column: number;
	elementType: string;
	propertyName: string;
	value: string;
	issues: ValidationIssue[];
}): void {
	const { filePath, line, column, elementType, propertyName, value, issues } = params;
	const elementSchema = UI_SCHEMA.elements[elementType];

	if (!elementSchema) {
		// This element is official, but we only have detailed property schema for a subset.
		return;
	}

	const propertySchema = elementSchema.properties[propertyName];
	if (!propertySchema) {
		const knownProperties = Object.keys(elementSchema.properties).sort().join(", ");
		issues.push({
			file: filePath,
			line,
			column,
			code: "unknown-property",
			element: elementType,
			property: propertyName,
			message: `Unknown property "${propertyName}" for element ${elementType}. Allowed properties: ${knownProperties}.`,
		});
		return;
	}

	const problem = validateValueAgainstSchema(value, propertySchema, `${elementType}.${propertyName}`);
	if (!problem) return;

	issues.push({
		file: filePath,
		line,
		column,
		code: "invalid-value",
		element: elementType,
		property: propertyName,
		message: `${problem.message} Expected ${propertySchema.docsType}; got ${value}.`,
	});
}

function validateValueAgainstSchema(
	rawValue: string,
	propertySchema: PropertySchema,
	propertyPath: string,
): ValidationProblem | null {
	const value = rawValue.trim();
	return validateValue(value, propertySchema.type, propertyPath);
}

function validateValue(value: string, schema: ValueSchema, propertyPath: string): ValidationProblem | null {
	switch (schema.kind) {
		case "any":
			return null;
		case "scalar":
			return validateScalar(value, schema.scalar, propertyPath);
		case "enum":
			if (schema.values.includes(value)) return null;
			if (isReferenceExpression(value)) return null;
			return {
				message: `${propertyPath} has invalid enum value "${value}". Valid values: ${schema.values.join(", ")}.`,
			};
		case "object":
			return validateObject(value, schema.objectType, propertyPath);
		case "union": {
			const errors: string[] = [];
			for (const variant of schema.variants) {
				const problem = validateValue(value, variant, propertyPath);
				if (!problem) return null;
				errors.push(problem.message);
			}
			return { message: errors[0] ?? `${propertyPath} has an invalid value.` };
		}
		default:
			return { message: `${propertyPath} has an unsupported schema definition.` };
	}
}

function validateScalar(value: string, scalarType: ScalarValueType, propertyPath: string): ValidationProblem | null {
	switch (scalarType) {
		case "boolean":
			if (/^(true|false)$/i.test(value)) return null;
			if (isReferenceExpression(value)) return null;
			return { message: `${propertyPath} must be a Boolean literal (true/false) or expression reference.` };
		case "integer":
			if (INTEGER_PATTERN.test(value)) return null;
			if (isReferenceExpression(value)) return null;
			return { message: `${propertyPath} must be an Integer literal or expression reference.` };
		case "float":
			if (FLOAT_PATTERN.test(value)) return null;
			if (isReferenceExpression(value)) return null;
			return { message: `${propertyPath} must be a Float literal or expression reference.` };
		case "string":
			if (isStringLike(value)) return null;
			return { message: `${propertyPath} must be a quoted string, translation key, or string binding.` };
		case "color":
			if (COLOR_PATTERN.test(value)) return null;
			if (isReferenceExpression(value)) return null;
			return {
				message: `${propertyPath} must be a valid color literal (#rrggbb, #rrggbb(a), #rrggbbaa) or expression reference.`,
			};
		case "uiPath":
			if (STRING_LITERAL_PATTERN.test(value)) return null;
			if (isReferenceExpression(value)) return null;
			return { message: `${propertyPath} must be a quoted UI path string or expression reference.` };
		default:
			return { message: `${propertyPath} has unsupported scalar type.` };
	}
}

function validateObject(value: string, objectType: string, propertyPath: string): ValidationProblem | null {
	if (isReferenceExpression(value)) return null;

	const parsed = parseObjectValue(value);
	if (!parsed) {
		return {
			message: `${propertyPath} must be an object literal like (Field: Value) or ${objectType}(Field: Value).`,
		};
	}

	if (parsed.typeName && parsed.typeName !== objectType) {
		return {
			message: `${propertyPath} uses object type ${parsed.typeName}, but ${objectType} is required.`,
		};
	}

	const objectSchema = UI_SCHEMA.objectTypes[objectType];
	if (!objectSchema) {
		return null;
	}

	for (const field of parsed.fields) {
		if (!IDENTIFIER_PATTERN.test(field.name)) {
			return {
				message: `${propertyPath} contains invalid field name "${field.name}".`,
			};
		}

		const fieldSchema = objectSchema.fields[field.name];
		if (!fieldSchema) {
			const allowedFields = Object.keys(objectSchema.fields).sort().join(", ");
			return {
				message: `${propertyPath} contains unknown field "${field.name}". Allowed fields: ${allowedFields}.`,
			};
		}

		const nestedPath = `${propertyPath}.${field.name}`;
		const nestedProblem = validateValue(field.value.trim(), fieldSchema.type, nestedPath);
		if (nestedProblem) return nestedProblem;
	}

	return null;
}

function parseObjectValue(value: string): ParsedObjectValue | null {
	const trimmed = value.trim();
	if (!trimmed) return null;

	if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
		return {
			typeName: null,
			fields: parseObjectFields(trimmed.slice(1, -1)),
		};
	}

	const typedObjectMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)\s*\(([\s\S]*)\)$/);
	if (!typedObjectMatch) return null;

	return {
		typeName: typedObjectMatch[1]!,
		fields: parseObjectFields(typedObjectMatch[2]!),
	};
}

function parseObjectFields(content: string): ObjectField[] {
	const fields: ObjectField[] = [];
	const chunks = splitTopLevel(content, ",");
	for (const chunk of chunks) {
		const trimmed = chunk.trim();
		if (!trimmed) continue;
		const colonIndex = findTopLevelCharacter(trimmed, ":");
		if (colonIndex === -1) {
			fields.push({ name: trimmed, value: "" });
			continue;
		}
		fields.push({
			name: trimmed.slice(0, colonIndex).trim(),
			value: trimmed.slice(colonIndex + 1).trim(),
		});
	}
	return fields;
}

function splitTopLevel(content: string, separator: string): string[] {
	const results: string[] = [];
	let current = "";
	let parenDepth = 0;
	let bracketDepth = 0;
	let inString = false;
	let escaped = false;

	for (let i = 0; i < content.length; i += 1) {
		const char = content[i];

		if (inString) {
			current += char;
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			current += char;
			continue;
		}

		if (char === "(") parenDepth += 1;
		if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
		if (char === "[") bracketDepth += 1;
		if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);

		if (char === separator && parenDepth === 0 && bracketDepth === 0) {
			results.push(current);
			current = "";
			continue;
		}

		current += char;
	}

	if (current.length > 0) results.push(current);
	return results;
}

function findTopLevelCharacter(content: string, needle: string): number {
	let parenDepth = 0;
	let bracketDepth = 0;
	let inString = false;
	let escaped = false;

	for (let i = 0; i < content.length; i += 1) {
		const char = content[i];

		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			continue;
		}

		if (char === "(") parenDepth += 1;
		if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
		if (char === "[") bracketDepth += 1;
		if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);

		if (char === needle && parenDepth === 0 && bracketDepth === 0) return i;
	}

	return -1;
}

function takeUntilTopLevelSemicolon(content: string): { complete: boolean; value: string } {
	let parenDepth = 0;
	let bracketDepth = 0;
	let inString = false;
	let escaped = false;

	for (let i = 0; i < content.length; i += 1) {
		const char = content[i];

		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			continue;
		}

		if (char === "(") parenDepth += 1;
		if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
		if (char === "[") bracketDepth += 1;
		if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);

		if (char === ";" && parenDepth === 0 && bracketDepth === 0) {
			return {
				complete: true,
				value: content.slice(0, i),
			};
		}
	}

	return {
		complete: false,
		value: content,
	};
}

function stripInlineComments(line: string): string {
	let inString = false;
	let escaped = false;

	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];

		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			continue;
		}

		if (char === "/" && line[i + 1] === "/") {
			return line.slice(0, i);
		}
	}

	return line;
}

function isReferenceExpression(value: string): boolean {
	return REFERENCE_PATTERN.test(value.trim());
}

function isStringLike(value: string): boolean {
	const trimmed = value.trim();
	return (
		STRING_LITERAL_PATTERN.test(trimmed) ||
		TRANSLATION_PATTERN.test(trimmed) ||
		REFERENCE_PATTERN.test(trimmed) ||
		BARE_STRING_PATTERN.test(trimmed)
	);
}

async function runCli(args: string[]): Promise<number> {
	if (args.length === 0) {
		console.error("Usage: bun run src/validator.ts <file.ui> [more.ui files]");
		return 1;
	}

	let totalIssues = 0;
	for (const uiPathInput of args) {
		const resolvedPath = path.resolve(uiPathInput);

		try {
			const result = await validateUiFile(resolvedPath);
			if (result.issues.length === 0) {
				console.log(`[ui-validate] ${resolvedPath}: ok`);
				continue;
			}

			totalIssues += result.issues.length;
			console.error(`[ui-validate] ${resolvedPath}: ${result.issues.length} issue(s)`);
			for (const issue of result.issues) {
				console.error(`  - ${formatValidationIssue(issue)}`);
			}
		} catch (error) {
			totalIssues += 1;
			console.error(
				`[ui-validate] ${resolvedPath}: failed to validate (${error instanceof Error ? error.message : String(error)})`,
			);
		}
	}

	return totalIssues > 0 ? 1 : 0;
}

if (import.meta.main) {
	runCli(process.argv.slice(2))
		.then(exitCode => {
			if (exitCode !== 0) process.exit(exitCode);
		})
		.catch(error => {
			console.error(error);
			process.exit(1);
		});
}
