import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { BrowserToolService } from "../core/browserToolService";
import { asToolResult } from "../core/toolResult";
import { objectSchema, optionalString } from "../core/schema";

export function registerBrowserPressTool(pi: ExtensionAPI, getService: (ctx: ExtensionContext) => BrowserToolService): void {
  pi.registerTool({
    name: "browser_press",
    label: "Browser Press",
    description: "Press a keyboard key or hotkey in the browser, such as Enter, Escape, Tab, or Control+L.",
    promptSnippet: "Press browser keys or hotkeys",
    promptGuidelines: ["Use browser_press for Enter, Escape, Tab, dropdowns, autocomplete, modals, and hotkeys."],
    parameters: objectSchema({
      tabId: optionalString("Optional browser tab id."),
      key: { type: "string", description: "Key or hotkey, e.g. Enter, Escape, Tab, Control+L." },
    }, ["key"]),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return asToolResult(await getService(ctx).press(params as any));
    },
  });
}
