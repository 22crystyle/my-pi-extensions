import { ContinuationStore, CONTINUATION_CHUNK_CHARS } from "./continuationStore";
import { BrowserToolError, toActionError } from "./errors";
import { buildPageKey } from "./pageMatcher";
import { ProviderRouter } from "./providerRouter";
import type {
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
        await this.uiStateStore.patch({ currentTabId: created.id });
        return { ok: true, tabId: created.id, url: created.url, title: created.title };
      }

      if (input.action === "switch_tab") {
        tab = await this.findTab(provider, input.tabTarget ?? input.tabId);
        if (!tab) throw new BrowserToolError("tab_not_found");
        await this.uiStateStore.patch({ currentTabId: tab.id });
        return { ok: true, tabId: tab.id, url: tab.url, title: tab.title };
      }

      tab = await this.getCurrentOrSpecifiedTab(provider, input.tabId, input.action === "url" ? input.url : undefined);
      const result = await provider.navigate({
        tabId: tab.id,
        action: input.action,
        url: input.url,
        waitUntil: input.waitUntil,
      });
      await this.uiStateStore.patch({ currentTabId: result.tabId });
      return { ok: result.ok, tabId: result.tabId, url: result.url, title: result.title };
    } catch (error) {
      const mapped = toActionError(error);
      return { ok: false, tabId: input.tabId ?? "", url: "", ...mapped };
    }
  }

  async snapshot(input: BrowserSnapshotInput): Promise<BrowserSnapshotResult> {
    const provider = await this.providerRouter.getProvider();
    const tab = await this.getCurrentOrSpecifiedTab(provider, input.tabId);
    await this.uiStateStore.patch({ currentTabId: tab.id });

    if (input.continuationId) {
      const continuation = this.continuationStore.get(input.continuationId);
      if (continuation && continuation.url === tab.url) {
        return this.sliceSnapshot(tab.url, continuation.text, input.offset ?? 0, continuation.id);
      }
    }

    const state = await this.uiStateStore.load();
    const currentUrl = tab.url;
    const pageKey = buildPageKey(currentUrl);
    const rules = await this.rulesStore.getEnabledRulesMatching(pageKey, currentUrl);

    if (rules.length > 0 && provider.pruneDomForSnapshot && provider.restoreDom) {
      try {
        await provider.pruneDomForSnapshot(tab.id, rules);
        const raw = await provider.getRawSnapshot({ tabId: tab.id, offset: 0, includeScreenshot: input.includeScreenshot });
        return this.sliceSnapshot(currentUrl, raw.snapshot ?? "", input.offset ?? 0);
      } finally {
        await provider.restoreDom(tab.id);
      }
    } else {
      const raw = await provider.getRawSnapshot({ tabId: tab.id, offset: 0, includeScreenshot: input.includeScreenshot });
      if (!state.debugRawSnapshot && rules.length === 0) return { url: currentUrl, snapshot: "", refsCount: 0, truncated: false, hasMore: false };
      return this.sliceSnapshot(currentUrl, raw.snapshot ?? "", input.offset ?? 0);
    }
  }

  async click(input: BrowserClickInput): Promise<BrowserClickResult> {
    try {
      const provider = await this.providerRouter.getProvider();
      const tab = await this.getCurrentOrSpecifiedTab(provider, input.tabId);
      const beforeUrl = tab.url;
      const target = this.resolveActionTarget(input.target);
      const result = await provider.click({
        tabId: tab.id,
        target,
        button: input.button,
        clickCount: input.clickCount,
        waitAfter: input.waitAfter,
      });
      const after = await this.getTab(provider, tab.id);
      return { ok: result.ok, tabId: tab.id, url: after?.url ?? result.url ?? beforeUrl, navigation: (after?.url ?? result.url) !== beforeUrl };
    } catch (error) {
      const mapped = toActionError(error);
      return { ok: false, tabId: input.tabId ?? "", ...mapped };
    }
  }

  async type(input: BrowserTypeInput): Promise<BrowserTypeResult> {
    try {
      const provider = await this.providerRouter.getProvider();
      const tab = await this.getCurrentOrSpecifiedTab(provider, input.tabId);
      const target = input.target ? this.resolveActionTarget(input.target) : undefined;
      const result = await provider.type({ tabId: tab.id, target, text: input.text, clear: input.clear, submit: input.submit });
      const after = await this.getTab(provider, tab.id);
      return { ok: result.ok, tabId: tab.id, url: after?.url ?? result.url ?? tab.url };
    } catch (error) {
      const mapped = toActionError(error);
      return { ok: false, tabId: input.tabId ?? "", ...mapped };
    }
  }

  async press(input: BrowserPressInput): Promise<BrowserPressResult> {
    try {
      const provider = await this.providerRouter.getProvider();
      const tab = await this.getCurrentOrSpecifiedTab(provider, input.tabId);
      const result = await provider.press({ tabId: tab.id, key: input.key });
      const after = await this.getTab(provider, tab.id);
      return { ok: result.ok, tabId: tab.id, url: after?.url ?? result.url ?? tab.url };
    } catch (error) {
      const mapped = toActionError(error);
      return { ok: false, tabId: input.tabId ?? "", ...mapped };
    }
  }

  async scroll(input: BrowserScrollInput): Promise<BrowserScrollResult> {
    try {
      const provider = await this.providerRouter.getProvider();
      const tab = await this.getCurrentOrSpecifiedTab(provider, input.tabId);
      const target = input.target ? this.resolveActionTarget(input.target) : undefined;
      const result = await provider.scroll({
        tabId: tab.id,
        target,
        direction: input.direction,
        amount: normalizeScrollAmount(input.amount),
      });
      const after = await this.getTab(provider, tab.id);
      return { ok: result.ok, tabId: tab.id, url: after?.url ?? result.url ?? tab.url };
    } catch (error) {
      const mapped = toActionError(error);
      return { ok: false, tabId: input.tabId ?? "", ...mapped };
    }
  }

  async collectCandidates(): Promise<SelectorCandidate[]> {
    const provider = await this.providerRouter.getProvider();
    return new CandidatesEngine(provider).collect();
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

  private async getCurrentOrSpecifiedTab(provider: BrowserProvider, tabId?: string, createUrl?: string): Promise<TabInfo> {
    if (tabId) {
      const tab = await this.getTab(provider, tabId);
      if (!tab) throw new BrowserToolError("tab_not_found");
      return tab;
    }

    const state = await this.uiStateStore.load();
    if (state.currentTabId) {
      const current = await this.getTab(provider, state.currentTabId).catch(() => undefined);
      if (current) return current;
    }

    const tabs = await provider.listTabs({});
    const first = tabs[0];
    if (first) {
      await this.uiStateStore.patch({ currentTabId: first.id });
      return first;
    }

    const created = await provider.createTab({ url: createUrl });
    await this.uiStateStore.patch({ currentTabId: created.id });
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
}

function normalizeScrollAmount(amount: BrowserScrollInput["amount"]): number | undefined {
  if (typeof amount === "number") return amount;
  if (amount === "small") return 350;
  if (amount === "large") return 1600;
  if (amount === "medium") return 800;
  return undefined;
}
