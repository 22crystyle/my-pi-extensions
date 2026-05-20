import { ContinuationStore, CONTINUATION_CHUNK_CHARS } from "./continuationStore";
import { BrowserToolError, toActionError } from "./errors";
import { buildPageKey } from "./pageMatcher";
import { ProviderRouter } from "./providerRouter";
import type {
  ActionResult,
  ActionTarget,
  BrowserClickInput,
  BrowserClickResult,
  BrowserNavigateInput,
  BrowserNavigateResult,
  BrowserProvider,
  BrowserRule,
  BrowserScrollInput,
  BrowserScrollResult,
  BrowserSnapshotInput,
  BrowserSnapshotResult,
  BrowserTypeInput,
  BrowserTypeResult,
  BrowserPressInput,
  BrowserPressResult,
  ProviderTarget,
  SelectorCandidate,
  TabInfo,
} from "./types";
import { nowIso, randomId } from "./utils";
import { CandidatesEngine } from "./candidatesEngine";
import { rangeEndBoundaryLocatorFromCandidate, rangeStartBoundaryLocatorFromCandidate } from "./selectorEngine";
import { RulesStore } from "../storage/rulesStore";
import { UiStateStore } from "../storage/uiStateStore";

export class BrowserToolService {
  readonly rulesStore: RulesStore;
  readonly uiStateStore: UiStateStore;

  private readonly providerRouter: ProviderRouter;
  private readonly continuationStore = new ContinuationStore();
  private readonly snapshotLinkUrls = new Map<string, Map<string, string>>();

  constructor(readonly cwd: string) {
    this.rulesStore = new RulesStore(cwd);
    this.uiStateStore = new UiStateStore(cwd);
    this.providerRouter = new ProviderRouter(this.uiStateStore);
  }

  dispose(): void {
    this.continuationStore.clear();
  }

  async navigate(input: BrowserNavigateInput): Promise<BrowserNavigateResult> {
    try {
      const provider = await this.providerRouter.getProvider();
      let tab: TabInfo | undefined;

      if (input.action === "new_tab") {
        const created = await provider.createTab({ url: input.url });
        await this.syncTabsState(provider);
        const state = await this.uiStateStore.load();
        const nextTabs = state.tabs.map(t => ({ ...t, active: t.id === created.id }));
        await this.uiStateStore.patch({ tabs: nextTabs });
        return { ok: true, url: created.url, title: created.title, tabs: this.formatTabs(nextTabs) };
      }

      if (input.action === "switch_tab") {
        await this.syncTabsState(provider);
        const state = await this.uiStateStore.load();
        let targetId: string | undefined;
        
        if (input.tabTarget && !isNaN(Number(input.tabTarget))) {
          const index = Number(input.tabTarget);
          targetId = state.tabs.find(t => t.index === index)?.id;
        }
        if (!targetId) {
          tab = await this.findTab(provider, input.tabTarget);
          targetId = tab?.id;
        }

        if (!targetId) throw new BrowserToolError("tab_not_found");
        const nextTabs = state.tabs.map(t => ({ ...t, active: t.id === targetId }));
        await this.uiStateStore.patch({ tabs: nextTabs });
        
        const activated = state.tabs.find(t => t.id === targetId);
        return { ok: true, url: activated?.url || "", title: activated?.title || "", tabs: this.formatTabs(nextTabs) };
      }

      tab = await this.getCurrentOrSpecifiedTab(provider, input.tabIndex, input.action === "url" ? input.url : undefined);
      const result = await provider.navigate({
        tabId: tab.id,
        action: input.action,
        url: input.url,
        waitUntil: input.waitUntil,
      });
      await this.syncTabsState(provider);
      const state = await this.uiStateStore.load();
      const nextTabs = state.tabs.map(t => ({ ...t, active: t.id === result.tabId }));
      await this.uiStateStore.patch({ tabs: nextTabs });
      return { ok: result.ok, url: result.url, title: result.title, tabs: this.formatTabs(nextTabs) };
    } catch (error) {
      const mapped = toActionError(error);
      return { ok: false, url: "", ...mapped };
    }
  }

  async snapshot(input: BrowserSnapshotInput): Promise<BrowserSnapshotResult> {
    const provider = await this.providerRouter.getProvider();
    const tab = await this.getCurrentOrSpecifiedTab(provider, input.tabIndex);
    const state = await this.uiStateStore.load();
    await this.uiStateStore.patch({ tabs: state.tabs.map(t => ({ ...t, active: t.id === tab.id })) });

    if (input.continuationId) {
      const continuation = this.continuationStore.get(input.continuationId);
      if (continuation && continuation.url === tab.url) {
        const sliced = this.sliceSnapshot(tab.url, continuation.text, input.offset ?? 0, continuation.id);
        sliced.tabs = this.formatTabs((await this.uiStateStore.load()).tabs);
        return sliced;
      }
    }

    const currentUrl = tab.url;
    const pageKey = buildPageKey(currentUrl);
    const rules = await this.rulesStore.getEnabledRulesMatching(pageKey, currentUrl);

    let rawSnapshot = "";
    if (rules.length > 0 && provider.pruneDomForSnapshot && provider.restoreDom) {
      try {
        await provider.pruneDomForSnapshot(tab.id, rules);
        const raw = await provider.getRawSnapshot({ tabId: tab.id, offset: 0, includeScreenshot: input.includeScreenshot });
        rawSnapshot = raw.snapshot ?? "";
      } finally {
        await provider.restoreDom(tab.id);
      }
    } else {
      const raw = await provider.getRawSnapshot({ tabId: tab.id, offset: 0, includeScreenshot: input.includeScreenshot });
      if (!state.debugRawSnapshot && rules.length === 0) rawSnapshot = "";
      else rawSnapshot = raw.snapshot ?? "";
    }

    if (!input.continuationId) {
      this.snapshotLinkUrls.set(this.snapshotLinkKey(tab.id, currentUrl), extractLinkUrlsByRef(rawSnapshot));
    }

    const sliced = this.sliceSnapshot(currentUrl, rawSnapshot, input.offset ?? 0);
    sliced.tabs = this.formatTabs((await this.uiStateStore.load()).tabs);
    return sliced;
  }

  async click(input: BrowserClickInput): Promise<BrowserClickResult> {
    try {
      const provider = await this.providerRouter.getProvider();
      const tab = await this.getCurrentOrSpecifiedTab(provider, input.tabIndex);
      const beforeUrl = tab.url;
      const target = this.resolveActionTarget(input.target);

      let needsRestore = false;
      if ('ref' in target && target.ref && provider.pruneDomForSnapshot && provider.restoreDom) {
        const pageKey = buildPageKey(tab.url);
        const rules = await this.rulesStore.getEnabledRulesMatching(pageKey, tab.url);
        if (rules.length > 0) {
          await provider.pruneDomForSnapshot(tab.id, rules);
          needsRestore = true;
        }
      }

      const beforeTabs = await provider.listTabs({}).catch(() => [tab]);
      const beforeTabIds = new Set(beforeTabs.map(t => t.id));
      const clickedRef = 'ref' in target ? target.ref : undefined;
      const snapshotLinkUrl = clickedRef ? this.snapshotLinkUrls.get(this.snapshotLinkKey(tab.id, beforeUrl))?.get(normalizeRef(clickedRef)) : undefined;

      let result: ActionResult;
      try {
        result = await provider.click({
          tabId: tab.id,
          target,
          button: input.button,
          clickCount: input.clickCount,
          waitAfter: input.waitAfter,
        });
      } finally {
        if (needsRestore) {
          await provider.restoreDom(tab.id).catch(() => {});
        }
      }

      const waitTimeoutMs = snapshotLinkUrl && input.waitAfter !== false ? 5000 : input.waitAfter === false ? 300 : 2000;
      const observedTabs = await this.waitForTabsAfterAction(provider, beforeTabIds, tab.id, beforeUrl, waitTimeoutMs, snapshotLinkUrl);
      await this.syncTabsState(provider, observedTabs);

      const openedTab = observedTabs.find(t => !beforeTabIds.has(t.id));
      let after = await this.getTab(provider, tab.id);

      if (openedTab) {
        const state = await this.uiStateStore.load();
        await this.uiStateStore.patch({ tabs: state.tabs.map(t => ({ ...t, active: t.id === openedTab.id })) });
      }

      after = await this.getTab(provider, tab.id);
      const tabs = this.formatTabs((await this.uiStateStore.load()).tabs);
      const currentUrl = openedTab?.url ?? after?.url ?? result.url ?? beforeUrl;
      return { ok: result.ok, url: currentUrl, navigation: Boolean(openedTab) || (after?.url ?? result.url) !== beforeUrl, tabs };
    } catch (error) {
      const mapped = toActionError(error);
      return { ok: false, ...mapped };
    }
  }

  async type(input: BrowserTypeInput): Promise<BrowserTypeResult> {
    try {
      const provider = await this.providerRouter.getProvider();
      const tab = await this.getCurrentOrSpecifiedTab(provider, input.tabIndex);
      const target = input.target ? this.resolveActionTarget(input.target) : undefined;

      let needsRestore = false;
      if (target && 'ref' in target && target.ref && provider.pruneDomForSnapshot && provider.restoreDom) {
        const pageKey = buildPageKey(tab.url);
        const rules = await this.rulesStore.getEnabledRulesMatching(pageKey, tab.url);
        if (rules.length > 0) {
          await provider.pruneDomForSnapshot(tab.id, rules);
          needsRestore = true;
        }
      }

      try {
        const result = await provider.type({ tabId: tab.id, target, text: input.text, clear: input.clear, submit: input.submit });
        await this.syncTabsState(provider);
        const after = await this.getTab(provider, tab.id);
        const tabs = this.formatTabs((await this.uiStateStore.load()).tabs);
        return { ok: result.ok, url: after?.url ?? result.url ?? tab.url, tabs };
      } finally {
        if (needsRestore) {
          await provider.restoreDom(tab.id).catch(() => {});
        }
      }
    } catch (error) {
      const mapped = toActionError(error);
      return { ok: false, ...mapped };
    }
  }

  async press(input: BrowserPressInput): Promise<BrowserPressResult> {
    try {
      const provider = await this.providerRouter.getProvider();
      const tab = await this.getCurrentOrSpecifiedTab(provider, input.tabIndex);
      const result = await provider.press({ tabId: tab.id, key: input.key });
      await this.syncTabsState(provider);
      const after = await this.getTab(provider, tab.id);
      const tabs = this.formatTabs((await this.uiStateStore.load()).tabs);
      return { ok: result.ok, url: after?.url ?? result.url ?? tab.url, tabs };
    } catch (error) {
      const mapped = toActionError(error);
      return { ok: false, ...mapped };
    }
  }

  async scroll(input: BrowserScrollInput): Promise<BrowserScrollResult> {
    try {
      const provider = await this.providerRouter.getProvider();
      const tab = await this.getCurrentOrSpecifiedTab(provider, input.tabIndex);
      const target = input.target ? this.resolveActionTarget(input.target) : undefined;

      let needsRestore = false;
      if (target && 'ref' in target && target.ref && provider.pruneDomForSnapshot && provider.restoreDom) {
        const pageKey = buildPageKey(tab.url);
        const rules = await this.rulesStore.getEnabledRulesMatching(pageKey, tab.url);
        if (rules.length > 0) {
          await provider.pruneDomForSnapshot(tab.id, rules);
          needsRestore = true;
        }
      }

      try {
        const result = await provider.scroll({
          tabId: tab.id,
          target,
          direction: input.direction,
          amount: normalizeScrollAmount(input.amount),
        });
        await this.syncTabsState(provider);
        const after = await this.getTab(provider, tab.id);
        const tabs = this.formatTabs((await this.uiStateStore.load()).tabs);
        return { ok: result.ok, url: after?.url ?? result.url ?? tab.url, tabs };
      } finally {
        if (needsRestore) {
          await provider.restoreDom(tab.id).catch(() => {});
        }
      }
    } catch (error) {
      const mapped = toActionError(error);
      return { ok: false, ...mapped };
    }
  }

  async collectCandidates(): Promise<SelectorCandidate[]> {
    const provider = await this.providerRouter.getProvider();
    const tab = await this.getCurrentOrSpecifiedTab(provider);
    return new CandidatesEngine(provider).collect([tab]);
  }

  async listTabs(): Promise<TabInfo[]> {
    const provider = await this.providerRouter.getProvider();
    return provider.listTabs({});
  }

  async createRuleFromCandidate(input: {
    candidate: SelectorCandidate;
    mode: "subtree" | "range";
    boundary?: "self" | "parent" | "parent+1" | "parent+2" | "custom";
    customSelector?: string;
    endCandidate?: SelectorCandidate;
    page?: BrowserRule["page"];
  }): Promise<BrowserRule> {
    const now = nowIso();
    if (input.mode === "range") {
      const rule: BrowserRule = {
        id: randomId("rule"),
        enabled: true,
        kind: "range",
        name: `Диапазон: ${input.candidate.label}`,
        page: input.page ?? input.candidate.page,
        source: "candidate",
        createdAt: now,
        updatedAt: now,
        start: rangeStartBoundaryLocatorFromCandidate(input.candidate),
        end: input.endCandidate ? rangeEndBoundaryLocatorFromCandidate(input.endCandidate) : { role: "heading", occurrence: 2, match: "structure" },
        includeStart: true,
        includeEnd: false,
      };
      await this.rulesStore.addRule(rule);
      return rule;
    }

    const provider = await this.providerRouter.getProvider();
    const occurrence = input.candidate.occurrences[0];
    let selector = input.customSelector || input.candidate.selector;
    const boundary = input.boundary ?? "self";
    
    // Simplification for the rewrite: assume boundary is self or customSelector is provided, 
    // because deriveAncestorSelector is removed from Provider
    
    const rule: BrowserRule = {
      id: randomId("rule"),
      enabled: true,
      kind: "subtree",
      name: `Область вокруг: ${input.candidate.label}`,
      page: input.page ?? input.candidate.page,
      source: "candidate",
      createdAt: now,
      updatedAt: now,
      selector,
    };
    await this.rulesStore.addRule(rule);
    return rule;
  }

  async addManualSubtreeRule(input: { name: string; selector: string; pageUrl?: string; page?: BrowserRule["page"] }): Promise<BrowserRule> {
    const provider = await this.providerRouter.getProvider();
    const tab = input.pageUrl ? undefined : await this.getCurrentOrSpecifiedTab(provider, undefined).catch(() => undefined);
    const url = input.pageUrl ?? tab?.url ?? "about:blank";
    const now = nowIso();
    const rule: BrowserRule = {
      id: randomId("rule"),
      enabled: true,
      kind: "subtree",
      name: input.name || input.selector,
      page: input.page ?? buildPageKey(url),
      source: "manual",
      createdAt: now,
      updatedAt: now,
      selector: input.selector,
    };
    await this.rulesStore.addRule(rule);
    return rule;
  }

  async previewRule(rule: BrowserRule): Promise<string> {
    const provider = await this.providerRouter.getProvider();
    const tab = await this.getCurrentOrSpecifiedTab(provider, undefined);
    if (!provider.pruneDomForSnapshot || !provider.restoreDom) return "Provider does not support pruning";
    
    try {
      await provider.pruneDomForSnapshot(tab.id, [rule]);
      const raw = await provider.getRawSnapshot({ tabId: tab.id });
      return raw.snapshot ?? "";
    } finally {
      await provider.restoreDom(tab.id);
    }
  }

  async previewCandidateSubtree(candidate: SelectorCandidate, boundary: "self" | "parent" | "parent+1" | "parent+2" | "custom", customSelector?: string): Promise<string> {
    const provider = await this.providerRouter.getProvider();
    const occurrence = candidate.occurrences[0];
    if (!occurrence) return "";
    
    const rule: BrowserRule = {
      id: randomId("preview"),
      enabled: true,
      kind: "subtree",
      name: "preview",
      page: candidate.page,
      source: "candidate",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      selector: customSelector || candidate.selector,
    };
    
    return this.previewRule(rule);
  }

  private sliceSnapshot(url: string, text: string, offset: number, continuationId?: string): BrowserSnapshotResult {
    const safeOffset = Math.max(0, offset || 0);
    const chunk = text.slice(safeOffset, safeOffset + CONTINUATION_CHUNK_CHARS);
    const hasMore = safeOffset + CONTINUATION_CHUNK_CHARS < text.length;
    // We don't store refMap anymore since it's handled by provider directly.
    // However, ContinuationStore constructor in original code took refMap as third param.
    // I need to make sure I update continuationStore.ts
    return {
      url,
      snapshot: chunk,
      refsCount: 0, // refsCount can be estimated or ignored
      truncated: hasMore,
      totalChars: text.length,
      hasMore,
      nextOffset: hasMore ? safeOffset + CONTINUATION_CHUNK_CHARS : undefined,
      continuationId: hasMore ? continuationId ?? this.continuationStore.create(url, text).id : continuationId,
    };
  }

  private snapshotLinkKey(tabId: string, url: string): string {
    return `${tabId}\n${url}`;
  }

  private resolveActionTarget(target: ActionTarget | { selector: string }): ProviderTarget {
    if ("ref" in target) {
      return { ref: target.ref };
    }
    if ("selector" in target) {
      return { selector: target.selector };
    }
    if ("text" in target) {
      throw new BrowserToolError("invalid_target", "Text target is not supported. Provide a concrete selector or ref.");
    }
    throw new BrowserToolError("invalid_target");
  }

  private async waitForTabsAfterAction(provider: BrowserProvider, beforeTabIds: Set<string>, tabId: string, beforeUrl: string, timeoutMs: number, expectedUrl?: string): Promise<TabInfo[]> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let lastTabs = await provider.listTabs({}).catch(() => [] as TabInfo[]);

    while (Date.now() <= deadline) {
      const openedTab = lastTabs.find(t => !beforeTabIds.has(t.id));
      const expectedTab = expectedUrl ? lastTabs.find(t => urlsEquivalent(t.url, expectedUrl)) : undefined;
      const currentTab = lastTabs.find(t => t.id === tabId);
      if (openedTab || expectedTab || (currentTab && currentTab.url !== beforeUrl)) return lastTabs;
      if (timeoutMs <= 0) break;
      await sleep(100);
      lastTabs = await provider.listTabs({}).catch(() => lastTabs);
    }

    return lastTabs;
  }

  async syncTabsState(provider: BrowserProvider, knownTabs?: TabInfo[]): Promise<void> {
    const tabs = knownTabs ?? await provider.listTabs({});
    let state = await this.uiStateStore.load();
    const currentTabs = [...state.tabs];

    // Remove closed tabs
    const activeProviderIds = new Set(tabs.map(t => t.id));
    let nextTabs = currentTabs.filter(t => activeProviderIds.has(t.id));

    // Add new tabs
    const existingIds = new Set(nextTabs.map(t => t.id));
    for (const t of tabs) {
      if (!existingIds.has(t.id)) {
        const nextIndex = nextTabs.length > 0 ? Math.max(...nextTabs.map(x => x.index)) + 1 : 1;
        nextTabs.push({ index: nextIndex, id: t.id, title: t.title || "New Tab", url: t.url, active: false });
      } else {
        // Update URL/title of existing tab
        const existing = nextTabs.find(x => x.id === t.id);
        if (existing) {
          existing.url = t.url;
          existing.title = t.title || existing.title;
        }
      }
    }

    // Ensure one active tab
    if (nextTabs.length > 0 && !nextTabs.some(t => t.active)) {
      nextTabs[0].active = true;
    }

    await this.uiStateStore.patch({ tabs: nextTabs });
  }

  private async getCurrentOrSpecifiedTab(provider: BrowserProvider, tabIndex?: number, createUrl?: string): Promise<TabInfo> {
    await this.syncTabsState(provider);
    const state = await this.uiStateStore.load();

    if (tabIndex !== undefined) {
      const specified = state.tabs.find(t => t.index === tabIndex);
      if (specified) {
        const tab = await this.getTab(provider, specified.id);
        if (tab) return tab;
      }
      throw new BrowserToolError("tab_not_found");
    }

    const activeTab = state.tabs.find(t => t.active);
    if (activeTab) {
      const current = await this.getTab(provider, activeTab.id).catch(() => undefined);
      if (current) return current;
    }

    const tabs = await provider.listTabs({});
    const first = tabs[0];
    if (first) {
      await this.syncTabsState(provider);
      const updatedState = await this.uiStateStore.load();
      const newActive = updatedState.tabs.find(t => t.id === first.id);
      if (newActive) {
        await this.uiStateStore.patch({ tabs: updatedState.tabs.map(t => ({ ...t, active: t.id === first.id })) });
      }
      return first;
    }

    const created = await provider.createTab({ url: createUrl });
    await this.syncTabsState(provider);
    const postState = await this.uiStateStore.load();
    await this.uiStateStore.patch({ tabs: postState.tabs.map(t => ({ ...t, active: t.id === created.id })) });
    return { id: created.id, url: created.url, title: created.title };
  }

  private async getTab(provider: BrowserProvider, tabId: string): Promise<TabInfo | undefined> {
    if (provider.getTab) return provider.getTab(tabId);
    return (await provider.listTabs({})).find((tab) => tab.id === tabId);
  }

  private async findTab(provider: BrowserProvider, target?: string): Promise<TabInfo | undefined> {
    const tabs = await provider.listTabs({});
    if (!target) return tabs[0];
    return tabs.find((tab) => tab.id === target || tab.targetId === target || tab.url.includes(target) || (tab.title ?? "").includes(target));
  }

  private formatTabs(tabs: Array<{ index: number; id: string; title: string; url: string; active: boolean }>) {
    return tabs.map(t => ({ index: t.index, title: t.title, url: t.url, active: t.active }));
  }
}

function normalizeScrollAmount(amount: BrowserScrollInput["amount"]): number | undefined {
  if (typeof amount === "number") return amount;
  if (amount === "small") return 350;
  if (amount === "large") return 1600;
  if (amount === "medium") return 800;
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeRef(ref: string): string {
  return ref.replace(/^\[/, "").replace(/\]$/, "");
}

function urlsEquivalent(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right, a.origin);
    return a.href === b.href;
  } catch {
    return left === right;
  }
}

function extractLinkUrlsByRef(snapshot: string): Map<string, string> {
  const out = new Map<string, string>();
  const stack: Array<{ indent: number; ref: string; role: string }> = [];

  for (const line of snapshot.split(/\r?\n/)) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();

    const nodeMatch = line.match(/^\s*-\s+([^\s:]+).*\[([^\]]+)\]:\s*$/);
    if (nodeMatch) {
      stack.push({ indent, role: nodeMatch[1], ref: normalizeRef(nodeMatch[2]) });
      continue;
    }

    const urlMatch = line.match(/^\s*-\s+\/url:\s*(\S+)\s*$/);
    if (!urlMatch) continue;

    const parent = [...stack].reverse().find(item => item.role === "link");
    if (parent) out.set(parent.ref, urlMatch[1]);
  }

  return out;
}
