export type JsonSchema = Record<string, unknown>;

export const emptyObjectSchema = (): JsonSchema => ({ type: "object", additionalProperties: false });

export const optionalString = (description?: string): JsonSchema => ({ type: "string", description });
export const booleanSchema = (description?: string): JsonSchema => ({ type: "boolean", description });
export const numberSchema = (description?: string): JsonSchema => ({ type: "number", description });

export function stringEnum(values: readonly string[], description?: string): JsonSchema {
  return { type: "string", enum: values, description };
}

export function objectSchema(properties: Record<string, JsonSchema>, required: string[] = [], description?: string): JsonSchema {
  return {
    type: "object",
    description,
    properties,
    required,
    additionalProperties: false,
  };
}

export function unionSchema(anyOf: JsonSchema[], description?: string): JsonSchema {
  return { anyOf, description };
}
