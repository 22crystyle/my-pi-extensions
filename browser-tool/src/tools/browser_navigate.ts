import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { BrowserToolService } from "../core/browserToolService";
import { asToolResult } from "../core/toolResult";
import { objectSchema, optionalString, stringEnum } from "../core/schema";

export function registerBrowserNavigateTool(pi: ExtensionAPI, getService: (ctx: ExtensionContext) => BrowserToolService): void {
  pi.registerTool({
    name: "browser_navigate",
    label: "Browser Navigate",
    description: "Open a URL, go back/forward, reload, create a new tab, or switch tabs. Does not return page content; call browser_snapshot separately.",
    promptSnippet: "Navigate browser tabs without returning page content",
    promptGuidelines: ["Use browser_snapshot after browser_navigate when page content is needed."],
    parameters: objectSchema({
      tabIndex: { type: "integer", description: "Optional browser tab index (1, 2, ...)." },
      action: stringEnum(["url", "back", "forward", "reload", "new_tab", "switch_tab"], "Navigation action."),
      url: optionalString("URL for action=url or action=new_tab."),
      tabTarget: optionalString("Tab index, URL fragment, or title fragment for switch_tab."),
      waitUntil: stringEnum(["none", "domcontentloaded", "load", "networkidle"], "Optional wait mode."),
    }, ["action"]),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return asToolResult(await getService(ctx).navigate(params as any));
    },
  });
}
