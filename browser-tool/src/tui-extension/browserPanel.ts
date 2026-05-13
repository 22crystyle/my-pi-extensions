import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { BrowserToolService } from "../core/browserToolService";
import type { BrowserRule, BrowserSnapshotInput, BrowserSnapshotResult, SelectorCandidate } from "../core/types";
import { formatPageMatcher, pageMatcherKey } from "../core/pageMatcher";
import { fuzzyMatch, truncateMiddle } from "../core/utils";
import { Input, Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { pickPageScope } from "./scopePicker";
import { boundaryLocatorFromCandidate } from "../core/selectorEngine";

export function registerBrowserPanel(pi: ExtensionAPI, getService: (ctx: ExtensionContext) => BrowserToolService): void {
  pi.registerCommand("browser", {
    description: "Open browser-tool Rules/Candidates panel",
    handler: async (_args, ctx) => {
      const service = getService(ctx);
      let keepOpen = true;
      while (keepOpen) {
        const action = await showPanel(ctx, service);
        if (!action || action.type === "close") break;
        keepOpen = await handlePanelAction(ctx, service, action);
      }
    },
  });

  pi.registerCommand("browser-config", {
    description: "Configure camofox-browser connection for browser-tool",
    handler: async (_args, ctx) => {
      await configureConnection(ctx, getService(ctx));
    },
  });

  pi.registerCommand("browser-snapshot", {
    description: "Show or export the exact browser_snapshot tool result the agent would receive",
    handler: async (args, ctx) => {
      const { input, editor, yaml, outputFile } = parseSnapshotCommandArgs(args);
      const service = getService(ctx);
      try {
        const result = await service.snapshot(input);
        const exactToolText = formatSnapshotToolResult(result);
        const outputText = yaml ? result.snapshot : exactToolText;
        if (outputFile) {
          const filePath = await exportSnapshotToFile(ctx, outputFile, outputText);
          ctx.ui.notify(`Exported browser snapshot to ${filePath}`, "info");
          return;
        }
        if (editor) {
          ctx.ui.setEditorText(outputText);
          ctx.ui.notify(yaml ? "Inserted browser snapshot YAML into editor" : "Inserted exact browser_snapshot tool result into editor", "info");
          return;
        }
        await showSnapshotResult(ctx, result, exactToolText);
      } catch (error) {
        await showText(ctx, "browser_snapshot failed", error instanceof Error ? error.message : String(error));
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const state = await getService(ctx).uiStateStore.load();
    ctx.ui.setStatus("browser-tool", `browser ${state.camofoxBaseUrl}`);
  });
}

type PanelAction =
  | { type: "close" }
  | { type: "refresh" }
  | { type: "config" }
  | { type: "toggle_all" }
  | { type: "toggle_rule"; ruleId: string }
  | { type: "delete_rule"; ruleId: string }
  | { type: "manual_rule" }
  | { type: "preview_rule"; rule: BrowserRule }
  | { type: "boundary"; candidate: SelectorCandidate };

function parseSnapshotCommandArgs(args: string): { input: BrowserSnapshotInput; editor: boolean; yaml: boolean; outputFile?: string } {
  const input: BrowserSnapshotInput = {};
  let editor = false;
  let yaml = false;
  let outputFile: string | undefined;
  const tokens = tokenizeCommandArgs(args);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--editor" || token === "-e") {
      editor = true;
    } else if (token === "--yaml" || token === "-y") {
      yaml = true;
    } else if ((token === "--file" || token === "-f") && tokens[i + 1]) {
      outputFile = tokens[++i];
    } else if (token.startsWith("--file=")) {
      outputFile = token.slice("--file=".length);
    } else if (token === "--tab" && tokens[i + 1]) {
      input.tabId = tokens[++i];
    } else if (token.startsWith("--tab=")) {
      input.tabId = token.slice("--tab=".length);
    } else if (token === "--offset" && tokens[i + 1]) {
      input.offset = Number(tokens[++i]) || 0;
    } else if (token.startsWith("--offset=")) {
      input.offset = Number(token.slice("--offset=".length)) || 0;
    } else if (token === "--continuation" && tokens[i + 1]) {
      input.continuationId = tokens[++i];
    } else if (token.startsWith("--continuation=")) {
      input.continuationId = token.slice("--continuation=".length);
    } else if (!token.startsWith("-") && !outputFile) {
      outputFile = token;
    }
  }

  return { input, editor, yaml, outputFile };
}

function tokenizeCommandArgs(args: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (const char of args) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function formatSnapshotToolResult(result: BrowserSnapshotResult): string {
  return JSON.stringify(result, null, 2);
}

async function exportSnapshotToFile(ctx: ExtensionContext, fileName: string, contents: string): Promise<string> {
  const filePath = resolve(ctx.cwd, fileName);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
  return filePath;
}

async function showPanel(ctx: ExtensionContext, service: BrowserToolService): Promise<PanelAction | undefined> {
  const [rules, candidates, state] = await Promise.all([
    service.rulesStore.listRules(),
    service.collectCandidates().catch(() => [] as SelectorCandidate[]),
    service.uiStateStore.load(),
  ]);

  return ctx.ui.custom<PanelAction | undefined>((tui, theme, _keybindings, done) => {
    let tab: "rules" | "candidates" = "rules";
    let selected = 0;
    let scroll = 0;
    const pageSize = 20;

    let filter = "";
    let filterMode = false;
    const filterInput = new Input();
    filterInput.onSubmit = (value) => {
      filter = value;
      filterMode = false;
      selected = 0;
      tui.requestRender();
    };
    filterInput.onEscape = () => {
      filter = filterInput.getValue();
      filterMode = false;
      selected = 0;
      tui.requestRender();
    };

    const themed = {
      title: (s: string) => theme.fg("accent", theme.bold(s)),
      muted: (s: string) => theme.fg("muted", s),
      dim: (s: string) => theme.fg("dim", s),
      success: (s: string) => theme.fg("success", s),
      warning: (s: string) => theme.fg("warning", s),
      selected: (s: string) => theme.bg("selectedBg", s),
    };

    function items(): PanelItem[] {
      const source = tab === "rules" ? buildRuleItems(rules) : buildCandidateItems(candidates);
      const visible = filter ? source.filter((item) => item.type === "header" || fuzzyMatch(item.search, filter)) : source;
      return visible.filter((item, index, array) => item.type !== "header" || array[index + 1]?.type !== "header");
    }

    function actionable(): PanelItem[] {
      return items().filter((item) => item.type !== "header");
    }

    function selectedItem(): PanelItem | undefined {
      const list = actionable();
      if (selected >= list.length) selected = Math.max(0, list.length - 1);
      return list[selected];
    }

    const component = {
      render(width: number): string[] {
        const list = items();
        selectedItem();
        const lines: string[] = [];
        lines.push(themed.title("Browser Tool") + themed.dim(`  ${state.camofoxBaseUrl}`));
        lines.push(`${tab === "rules" ? themed.success("[Rules]") : " Rules "} ${tab === "candidates" ? themed.success("[Candidates]") : " Candidates "}  ${filterMode ? themed.warning("/") : "/"}${filterMode ? filterInput.getValue() : filter}`);
        lines.push(themed.dim("tab switch • ↑↓ select • / filter • c config • esc close"));
        lines.push(themed.dim(tab === "rules" ? "space toggle • e toggle all • d delete • a manual • p preview" : "enter boundary picker • r refresh"));
        lines.push("─".repeat(Math.max(1, Math.min(width, 80))));

        let actionIndex = 0;
        let lastHeader = "";
        let printedHeaderForCurrentGroup = false;

        // Auto-scroll logic to keep the selected item in view
        const actionableItems = actionable();
        if (selected >= scroll + pageSize) {
          scroll = selected - pageSize + 1;
        } else if (selected < scroll) {
          scroll = selected;
        }

        for (const item of list) {
          if (item.type === "header") {
            lastHeader = item.label;
            printedHeaderForCurrentGroup = false;
            continue;
          }

          const isSelected = actionIndex === selected;
          const prefix = isSelected ? "> " : "  ";
          const marker = item.type === "rule" ? (item.rule.enabled ? "[x]" : "[ ]") : "[+]";
          let text = "";
          if (item.type === "rule") {
            text = `${prefix}${marker} ${item.rule.name}  ${describeRule(item.rule)}`;
          } else {
            const count = item.candidate.occurrences.length > 1 ? `  ${item.candidate.occurrences.length} matches` : "";
            text = `${prefix}${marker} ${item.candidate.label}: ${item.candidate.kind}: ${item.candidate.selector}${count}`;
          }

          if (actionIndex >= scroll && actionIndex < scroll + pageSize) {
            if (!printedHeaderForCurrentGroup) {
              lines.push(themed.muted(`Page: ${lastHeader}`));
              printedHeaderForCurrentGroup = true;
            }
            lines.push(isSelected ? themed.selected(truncateToWidth(text, width)) : truncateToWidth(text, width));
          }
          
          actionIndex++;
        }

        if (actionableItems.length > scroll + pageSize) {
          lines.push(themed.dim(`… ${actionableItems.length - (scroll + pageSize)} more`));
        }

        if (actionable().length === 0) {
          lines.push(themed.dim(tab === "rules" ? "No rules. Press a to add a manual subtree rule or switch to Candidates." : "No candidates. Open a browser tab or press r to refresh."));
        }
        return lines.map((line) => truncateToWidth(line, width));
      },
      invalidate() {},
      handleInput(data: string) {
        if (filterMode) {
          filterInput.handleInput(data);
          filter = filterInput.getValue();
          selected = 0;
          tui.requestRender();
          return;
        }

        if (matchesKey(data, Key.escape)) return done({ type: "close" });
        if (matchesKey(data, Key.tab)) { tab = tab === "rules" ? "candidates" : "rules"; selected = 0; tui.requestRender(); return; }
        if (matchesKey(data, Key.slash)) { filterInput.setValue(filter); filterMode = true; tui.requestRender(); return; }
        if (matchesKey(data, "c")) return done({ type: "config" });
        if (matchesKey(data, "r") && tab === "candidates") return done({ type: "refresh" });
        if (matchesKey(data, Key.up)) { selected = Math.max(0, selected - 1); tui.requestRender(); return; }
        if (matchesKey(data, Key.down)) { selected = Math.min(Math.max(0, actionable().length - 1), selected + 1); tui.requestRender(); return; }

        const current = selectedItem();
        if (tab === "rules") {
          if (matchesKey(data, "e")) return done({ type: "toggle_all" });
          if (matchesKey(data, "a")) return done({ type: "manual_rule" });
          if (current?.type === "rule" && matchesKey(data, Key.space)) return done({ type: "toggle_rule", ruleId: current.rule.id });
          if (current?.type === "rule" && matchesKey(data, "d")) return done({ type: "delete_rule", ruleId: current.rule.id });
          if (current?.type === "rule" && matchesKey(data, "p")) return done({ type: "preview_rule", rule: current.rule });
        } else if (current?.type === "candidate" && matchesKey(data, Key.enter)) {
          return done({ type: "boundary", candidate: current.candidate });
        }
      },
    };

    return component;
  });
}

async function handlePanelAction(ctx: ExtensionContext, service: BrowserToolService, action: PanelAction): Promise<boolean> {
  switch (action.type) {
    case "refresh":
      return true;
    case "config":
      await configureConnection(ctx, service);
      return true;
    case "toggle_all": {
      const enabled = await service.rulesStore.toggleAll();
      ctx.ui.notify(enabled ? "Enabled all browser rules" : "Disabled all browser rules", "info");
      return true;
    }
    case "toggle_rule":
      await service.rulesStore.toggleRule(action.ruleId);
      return true;
    case "delete_rule":
      if (await ctx.ui.confirm("Delete rule?", "This removes the selected browser visibility rule.")) {
        await service.rulesStore.deleteRule(action.ruleId);
      }
      return true;
    case "manual_rule":
      await addManualRule(ctx, service);
      return true;
    case "preview_rule":
      await previewRule(ctx, service, action.rule);
      return true;
    case "boundary":
      await openBoundaryPicker(ctx, service, action.candidate);
      return true;
    case "close":
      return false;
  }
}

async function configureConnection(ctx: ExtensionContext, service: BrowserToolService): Promise<void> {
  const state = await service.uiStateStore.load();
  const baseUrl = await ctx.ui.input("camofox-browser URL", state.camofoxBaseUrl);
  if (!baseUrl) return;
  const userId = await ctx.ui.input("camofox userId", state.userId);
  if (!userId) return;
  const sessionKey = await ctx.ui.input("camofox sessionKey", state.sessionKey);
  if (!sessionKey) return;
  const debugRaw = await ctx.ui.confirm("Debug raw snapshot?", "When no rules match, return raw camofox snapshot. Keep disabled for normal safe use.");
  await service.uiStateStore.patch({ camofoxBaseUrl: baseUrl, userId, sessionKey, debugRawSnapshot: debugRaw });
  ctx.ui.setStatus("browser-tool", `browser ${baseUrl}`);
  ctx.ui.notify("browser-tool connection updated", "info");
}

async function addManualRule(ctx: ExtensionContext, service: BrowserToolService): Promise<void> {
  const selector = await ctx.ui.input("Manual subtree selector", "main");
  if (!selector) return;
  const name = await ctx.ui.input("Rule name", selector);
  const tabs = await service.listTabs().catch(() => []);
  const url = tabs[0]?.url;
  const page = await pickPageScope(ctx, url, { host: "*", path: "*", query: "ignore", hash: "ignore" });
  await service.addManualSubtreeRule({ name: name || selector, selector, pageUrl: url, page });
  ctx.ui.notify("Browser rule added", "info");
}

async function previewRule(ctx: ExtensionContext, service: BrowserToolService, rule: BrowserRule): Promise<void> {
  const preview = await service.previewRule(rule).catch((error) => `Preview failed: ${error instanceof Error ? error.message : String(error)}`);
  await showText(ctx, `Preview: ${rule.name}`, preview || "(empty)");
}

async function openBoundaryPicker(ctx: ExtensionContext, service: BrowserToolService, candidate: SelectorCandidate): Promise<void> {
  const allCandidates = await service.collectCandidates().catch(() => [] as SelectorCandidate[]);
  const samePage = allCandidates.filter((item) => pageMatcherKey(item.page) === pageMatcherKey(candidate.page) && item.id !== candidate.id);
  const result = await ctx.ui.custom<BoundaryResult | undefined>((tui, theme, _keybindings, done) => {
    const modes: Array<"subtree" | "range" | "manual"> = ["subtree", "range", "manual"];
    const boundaries: Array<"self" | "parent" | "parent+1" | "parent+2" | "custom"> = ["self", "parent", "parent+1", "parent+2", "custom"];
    let modeIndex = 0;
    let boundaryIndex = 0;
    let endIndex = 0;

    const component = {
      render(width: number): string[] {
        const lines: string[] = [];
        lines.push(theme.fg("accent", theme.bold(`Boundary picker: ${candidate.label}`)));
        lines.push(theme.fg("dim", "←→ mode • ↑↓ option • p preview • enter add • esc cancel"));
        lines.push(`Page: ${formatPageMatcher(candidate.page)}`);
        lines.push(`Candidate: ${candidate.kind}: ${candidate.selector}`);
        lines.push("─".repeat(Math.max(1, Math.min(width, 80))));
        lines.push("Boundary mode:");
        for (let i = 0; i < modes.length; i++) lines.push(`${i === modeIndex ? ">" : " "} ${modes[i]}`);
        lines.push("");
        if (modes[modeIndex] === "subtree") {
          lines.push("Subtree boundary:");
          for (let i = 0; i < boundaries.length; i++) lines.push(`${i === boundaryIndex ? ">" : " "} ${boundaries[i]}`);
        } else if (modes[modeIndex] === "range") {
          lines.push(`Start: ${candidate.label}`);
          lines.push("End:");
          const ends = samePage.slice(0, 20);
          if (!ends.length) lines.push(theme.fg("warning", "  No other boundary candidates on this page."));
          for (let i = 0; i < ends.length; i++) {
            const item = ends[i];
            lines.push(`${i === endIndex ? ">" : " "} ${item.kind}: ${truncateMiddle(item.label, 60)}  ${truncateMiddle(item.selector, 70)}`);
          }
        } else {
          lines.push("Manual mode adds a subtree rule from a custom selector.");
        }
        return lines.map((line) => truncateToWidth(line, width));
      },
      invalidate() {},
      handleInput(data: string) {
        const mode = modes[modeIndex];
        if (matchesKey(data, Key.escape)) return done(undefined);
        if (matchesKey(data, Key.left)) { modeIndex = Math.max(0, modeIndex - 1); tui.requestRender(); return; }
        if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) { modeIndex = Math.min(modes.length - 1, modeIndex + 1); tui.requestRender(); return; }
        if (matchesKey(data, Key.up)) {
          if (mode === "subtree") boundaryIndex = Math.max(0, boundaryIndex - 1);
          else if (mode === "range") endIndex = Math.max(0, endIndex - 1);
          tui.requestRender(); return;
        }
        if (matchesKey(data, Key.down)) {
          if (mode === "subtree") boundaryIndex = Math.min(boundaries.length - 1, boundaryIndex + 1);
          else if (mode === "range") endIndex = Math.min(Math.max(0, samePage.slice(0, 20).length - 1), endIndex + 1);
          tui.requestRender(); return;
        }
        if (matchesKey(data, "p")) return done({ action: "preview", mode, boundary: boundaries[boundaryIndex], endCandidate: samePage[endIndex] });
        if (matchesKey(data, Key.enter)) return done({ action: "add", mode, boundary: boundaries[boundaryIndex], endCandidate: samePage[endIndex] });
      },
    };
    return component;
  });

  if (!result) return;

  let customSelector: string | undefined;
  if ((result.mode === "subtree" && result.boundary === "custom") || result.mode === "manual") {
    customSelector = await ctx.ui.input("Custom selector", candidate.selector);
    if (!customSelector) return;
  }

  if (result.action === "preview") {
    const preview = result.mode === "range"
      ? await previewCandidateRange(service, candidate, result.endCandidate).catch((error) => `Preview failed: ${error instanceof Error ? error.message : String(error)}`)
      : await service.previewCandidateSubtree(candidate, result.boundary, customSelector).catch((error) => `Preview failed: ${error instanceof Error ? error.message : String(error)}`);
    await showText(ctx, `Preview: ${candidate.label}`, preview || "(empty)");
    return;
  }

  const page = await pickPageScope(ctx, candidate.occurrences[0]?.url, candidate.page);
  const rule = await service.createRuleFromCandidate({
    candidate,
    mode: result.mode === "range" ? "range" : "subtree",
    boundary: result.boundary,
    customSelector,
    endCandidate: result.endCandidate,
    page,
  });
  ctx.ui.notify(`Browser rule added: ${rule.name}`, "info");
}

type BoundaryResult = {
  action: "preview" | "add";
  mode: "subtree" | "range" | "manual";
  boundary: "self" | "parent" | "parent+1" | "parent+2" | "custom";
  endCandidate?: SelectorCandidate;
};

async function previewCandidateRange(service: BrowserToolService, start: SelectorCandidate, end?: SelectorCandidate): Promise<string> {
  if (!end) return "Select an end boundary candidate before previewing a range.";
  const now = new Date().toISOString();
  return service.previewRule({
    id: "preview_range",
    enabled: true,
    kind: "range",
    name: `Preview: ${start.label}`,
    page: start.page,
    source: "candidate",
    createdAt: now,
    updatedAt: now,
    start: boundaryLocatorFromCandidate(start),
    end: boundaryLocatorFromCandidate(end),
    includeStart: true,
    includeEnd: false,
  });
}

async function showSnapshotResult(ctx: ExtensionContext, result: BrowserSnapshotResult, exactToolText: string): Promise<void> {
  const lines = exactToolText.split(/\r?\n/);
  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    let scroll = 0;
    const pageSize = 28;
    const maxScroll = () => Math.max(0, lines.length - pageSize);
    const clampScroll = () => { scroll = Math.min(maxScroll(), Math.max(0, scroll)); };

    return {
      render(width: number) {
        clampScroll();
        const header = `browser_snapshot result • url=${result.url} • refs=${result.refsCount} • chars=${result.totalChars ?? result.snapshot.length}`;
        const more = result.hasMore ? ` • hasMore nextOffset=${result.nextOffset} continuationId=${result.continuationId}` : "";
        const rendered: string[] = [
          theme.fg("accent", theme.bold("Exact agent-facing browser_snapshot output")),
          theme.fg("dim", header + more),
          theme.fg("dim", "↑↓/j/k scroll • g/G top/bottom • e put exact JSON in editor • y put YAML snapshot in editor • esc close"),
          "─".repeat(Math.max(1, Math.min(width, 80))),
        ];
        for (const line of lines.slice(scroll, scroll + pageSize)) rendered.push(truncateToWidth(line, width));
        if (lines.length > pageSize) rendered.push(theme.fg("dim", `─ ${scroll + 1}-${Math.min(lines.length, scroll + pageSize)} of ${lines.length} lines`));
        return rendered;
      },
      invalidate() {},
      handleInput(data: string) {
        if (matchesKey(data, Key.escape) || matchesKey(data, "q")) return done(undefined);
        if (matchesKey(data, Key.down) || matchesKey(data, "j")) { scroll += 1; clampScroll(); tui.requestRender(); return; }
        if (matchesKey(data, Key.up) || matchesKey(data, "k")) { scroll -= 1; clampScroll(); tui.requestRender(); return; }
        if (matchesKey(data, "g")) { scroll = 0; tui.requestRender(); return; }
        if (matchesKey(data, Key.shift("g"))) { scroll = maxScroll(); tui.requestRender(); return; }
        if (matchesKey(data, "e")) {
          ctx.ui.setEditorText(exactToolText);
          ctx.ui.notify("Inserted exact browser_snapshot tool result into editor", "info");
          return;
        }
        if (matchesKey(data, "y")) {
          ctx.ui.setEditorText(result.snapshot);
          ctx.ui.notify("Inserted browser snapshot YAML into editor", "info");
          return;
        }
      },
    };
  });
}

async function showText(ctx: ExtensionContext, title: string, text: string): Promise<void> {
  await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => ({
    render(width: number) {
      const lines = [theme.fg("accent", theme.bold(title)), theme.fg("dim", "enter/esc close"), "─".repeat(Math.max(1, Math.min(width, 80)))];
      for (const line of text.split(/\r?\n/).slice(0, 40)) lines.push(truncateToWidth(line, width));
      if (text.split(/\r?\n/).length > 40) lines.push(theme.fg("dim", "… preview truncated"));
      return lines;
    },
    invalidate() {},
    handleInput(data: string) { if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) done(undefined); },
  }));
}

type PanelItem =
  | { type: "header"; label: string; search: string }
  | { type: "rule"; rule: BrowserRule; search: string }
  | { type: "candidate"; candidate: SelectorCandidate; search: string };

function buildRuleItems(rules: BrowserRule[]): PanelItem[] {
  const groups = new Map<string, BrowserRule[]>();
  for (const rule of rules) {
    const key = formatPageMatcher(rule.page);
    const list = groups.get(key) ?? [];
    list.push(rule);
    groups.set(key, list);
  }
  const out: PanelItem[] = [];
  for (const [page, items] of Array.from(groups.entries()).sort()) {
    out.push({ type: "header", label: page, search: page });
    for (const rule of items) out.push({ type: "rule", rule, search: `${rule.name} ${describeRule(rule)} ${page}` });
  }
  return out;
}

function buildCandidateItems(candidates: SelectorCandidate[]): PanelItem[] {
  const groups = new Map<string, SelectorCandidate[]>();
  for (const candidate of candidates) {
    const key = formatPageMatcher(candidate.page);
    const list = groups.get(key) ?? [];
    list.push(candidate);
    groups.set(key, list);
  }
  const out: PanelItem[] = [];
  for (const [page, items] of Array.from(groups.entries()).sort()) {
    out.push({ type: "header", label: page, search: page });
    for (const candidate of items) out.push({ type: "candidate", candidate, search: `${candidate.label} ${candidate.role ?? ""} ${candidate.selector} ${candidate.href ?? ""} ${candidate.occurrences.map((occ) => `${occ.title ?? ""} ${occ.url}`).join(" ")}` });
  }
  return out;
}

function describeRule(rule: BrowserRule): string {
  if (rule.kind === "subtree") return rule.selector;
  return `range: ${rule.start.role ?? rule.start.text ?? rule.start.selector ?? "start"} -> ${rule.end.role ?? rule.end.text ?? rule.end.selector ?? "end"}`;
}
