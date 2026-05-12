import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { BrowserToolService } from "./src/core/browserToolService";
import { registerBrowserNavigateTool } from "./src/tools/browser_navigate";
import { registerBrowserSnapshotTool } from "./src/tools/browser_snapshot";
import { registerBrowserClickTool } from "./src/tools/browser_click";
import { registerBrowserTypeTool } from "./src/tools/browser_type";
import { registerBrowserPressTool } from "./src/tools/browser_press";
import { registerBrowserScrollTool } from "./src/tools/browser_scroll";
import { registerBrowserPanel } from "./src/tui-extension/browserPanel";

export default function browserToolExtension(pi: ExtensionAPI) {
  const services = new Map<string, BrowserToolService>();

  const getService = (ctxOrCwd: ExtensionContext | string): BrowserToolService => {
    const cwd = typeof ctxOrCwd === "string" ? ctxOrCwd : ctxOrCwd.cwd;
    let service = services.get(cwd);
    if (!service) {
      service = new BrowserToolService(cwd);
      services.set(cwd, service);
    }
    return service;
  };

  registerBrowserNavigateTool(pi, getService);
  registerBrowserSnapshotTool(pi, getService);
  registerBrowserClickTool(pi, getService);
  registerBrowserTypeTool(pi, getService);
  registerBrowserPressTool(pi, getService);
  registerBrowserScrollTool(pi, getService);

  registerBrowserPanel(pi, getService);

  pi.on("session_shutdown", async () => {
    for (const service of services.values()) service.dispose();
    services.clear();
  });
}
