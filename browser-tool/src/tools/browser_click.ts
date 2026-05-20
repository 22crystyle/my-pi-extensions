import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { BrowserToolService } from "../core/browserToolService";
import { asToolResult } from "../core/toolResult";
import { booleanSchema, objectSchema, optionalString, stringEnum, unionSchema } from "../core/schema";

const targetSchema = unionSchema([
  objectSchema({ ref: optionalString("Element ref from the last browser_snapshot.") }, ["ref"]),
  objectSchema({ selector: optionalString("CSS selector, allowed only inside the last visible snapshot areas.") }, ["selector"]),
  objectSchema({ text: optionalString("Visible text target, allowed only inside the last visible snapshot areas.") }, ["text"]),
]);

export function registerBrowserClickTool(pi: ExtensionAPI, getService: (ctx: ExtensionContext) => BrowserToolService): void {
  pi.registerTool({
    name: "browser_click",
    label: "Browser Click",
    description: "Click an element that was visible in the last filtered browser_snapshot.",
    promptSnippet: "Click a visible browser element by snapshot ref",
    promptGuidelines: ["Prefer browser_click with target.ref values returned by the latest browser_snapshot."],
    parameters: objectSchema({
      tabIndex: { type: "integer", description: "Optional browser tab index (1, 2, ...)." },
      target: targetSchema,
      button: stringEnum(["left", "right", "middle"], "Mouse button."),
      clickCount: { type: "integer", enum: [1, 2], description: "Single or double click." },
      waitAfter: booleanSchema("Whether to wait after clicking."),
    }, ["target"]),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return asToolResult(await getService(ctx).click(params as any));
    },
  });
}
