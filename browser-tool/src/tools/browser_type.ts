import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { BrowserToolService } from "../core/browserToolService";
import { asToolResult } from "../core/toolResult";
import { booleanSchema, objectSchema, optionalString, unionSchema } from "../core/schema";

const targetSchema = unionSchema([
  objectSchema({ ref: optionalString("Element ref from the last browser_snapshot.") }, ["ref"]),
  objectSchema({ selector: optionalString("CSS selector, allowed only inside the last visible snapshot areas.") }, ["selector"]),
]);

export function registerBrowserTypeTool(pi: ExtensionAPI, getService: (ctx: ExtensionContext) => BrowserToolService): void {
  pi.registerTool({
    name: "browser_type",
    label: "Browser Type",
    description: "Type text into an input, textarea, combobox, contenteditable, or the currently focused element.",
    promptSnippet: "Type text into a visible browser field or focused element",
    promptGuidelines: ["Use browser_type with a target.ref from browser_snapshot when typing into a specific field."],
    parameters: objectSchema({
      tabIndex: { type: "integer", description: "Optional browser tab index (1, 2, ...)." },
      target: targetSchema,
      text: { type: "string", description: "Text to type." },
      clear: booleanSchema("Clear the field before typing."),
      submit: booleanSchema("Press Enter after typing."),
    }, ["text"]),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return asToolResult(await getService(ctx).type(params as any));
    },
  });
}
