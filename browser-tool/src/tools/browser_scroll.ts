import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { BrowserToolService } from "../core/browserToolService";
import { asToolResult } from "../core/toolResult";
import { objectSchema, optionalString, stringEnum, unionSchema } from "../core/schema";

const targetSchema = unionSchema([
  objectSchema({ ref: optionalString("Element ref from the last browser_snapshot.") }, ["ref"]),
  objectSchema({ selector: optionalString("CSS selector, allowed only inside the last visible snapshot areas.") }, ["selector"]),
]);

export function registerBrowserScrollTool(pi: ExtensionAPI, getService: (ctx: ExtensionContext) => BrowserToolService): void {
  pi.registerTool({
    name: "browser_scroll",
    label: "Browser Scroll",
    description: "Scroll the page or a visible scrollable area from the last filtered browser_snapshot.",
    promptSnippet: "Scroll the browser page or a visible area",
    promptGuidelines: ["Use browser_scroll without a target to scroll the page; targeted scroll requires a visible ref or selector."],
    parameters: objectSchema({
      tabIndex: { type: "integer", description: "Optional browser tab index (1, 2, ...)." },
      target: targetSchema,
      direction: stringEnum(["up", "down", "left", "right"], "Scroll direction."),
      amount: unionSchema([
        stringEnum(["small", "medium", "large"]),
        { type: "number", description: "Pixel amount." },
      ], "Scroll amount."),
    }, ["direction"]),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return asToolResult(await getService(ctx).scroll(params as any));
    },
  });
}
