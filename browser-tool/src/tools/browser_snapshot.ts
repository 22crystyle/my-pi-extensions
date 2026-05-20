import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { BrowserToolService } from "../core/browserToolService";
import { asToolResult } from "../core/toolResult";
import { booleanSchema, numberSchema, objectSchema, optionalString } from "../core/schema";

export function registerBrowserSnapshotTool(pi: ExtensionAPI, getService: (ctx: ExtensionContext) => BrowserToolService): void {
  pi.registerTool({
    name: "browser_snapshot",
    label: "Browser Snapshot",
    description: "Return a camofox-like YAML accessibility snapshot filtered to the user-enabled visible areas for the current page.",
    promptSnippet: "Read the filtered browser accessibility snapshot as YAML",
    promptGuidelines: [
      "Use browser_snapshot to inspect page content before browser_click, browser_type, or targeted browser_scroll.",
      "browser_snapshot returns only refs that are currently actionable by browser tools.",
    ],
    parameters: objectSchema({
      tabIndex: { type: "integer", description: "Optional browser tab index (1, 2, ...)." },
      offset: numberSchema("Optional continuation offset from a previous browser_snapshot result."),
      includeScreenshot: booleanSchema("Reserved for provider support; does not change agent-visible filtering."),
      continuationId: optionalString("Continuation id from a previous truncated browser_snapshot result."),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return asToolResult(await getService(ctx).snapshot(params as any));
    },
  });
}
