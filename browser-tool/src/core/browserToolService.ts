import { ContinuationStore, CONTINUATION_CHUNK_CHARS } from "./continuationStore";
import { BrowserToolError, toActionError } from "./errors";
import { buildPageKey } from "./pageMatcher";
import { ProviderRouter } from "./providerRouter";
import { RefMapStore, assignRefsAndBuildMap, countRefs, filterRefMapToRenderedText } from "./refMap";
import { RulesEngine } from "./rulesEngine";
import { dedupeSnapshotNodes } from "./snapshotMaterializer";
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
  SnapshotNode,
  TabInfo,
} from "./types";
import { normalizeLabel, nowIso, randomId } from "./utils";
import { renderCamofoxLikeYaml } from "../providers/camofox/camofoxYamlRenderer";
import { CandidatesEngine } from "./candidatesEngine";
import { boundaryLocatorFromCandidate } from "./selectorEngine";
import { RulesStore } from "../storage/rulesStore";
import { UiStateStore } from "../storage/uiStateStore";

export class BrowserToolService {
  readonly rulesStore: RulesStore;
  readonly uiStateStore: UiStateStore;

  private readonly providerRouter: ProviderRouter;
  private readonly refMapStore = new RefMapStore();
  private readonly continuationStore = new ContinuationStore();

  constructor(readonly cwd: string) {
    this.rulesStore = new RulesStore(cwd);
    this.uiStateStore = new UiStateStore(cwd);
    this.providerRouter = new ProviderRouter(this.uiStateStore);
  }

  dispose(): void {
    this.refMapStore.clear();
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
        return this.sliceSnapshot(tab.id, continuation.url, continuation.text, continuation.refMap, input.offset ?? 0, continuation.id);
      }
    }

    const state = await this.uiStateStore.load();
    const currentUrl = tab.url;
    const pageKey = buildPageKey(currentUrl);
    const rules = await this.rulesStore.getEnabledRulesMatching(pageKey, currentUrl);

    if (rules.length === 0 && !state.debugRawSnapshot) {
      this.refMapStore.save(tab.id, { tabId: tab.id, url: currentUrl, page: pageKey, entries: {}, areaSelectors: [] });
      return { url: currentUrl, snapshot: "", refsCount: 0, truncated: false, hasMore: false };
    }

    if (state.debugRawSnapshot && rules.length === 0) {
      const raw = await provider.getRawSnapshot({
        tabId: tab.id,
        offset: input.offset,
        includeScreenshot: input.includeScreenshot,
      });
      return raw;
    }

    const materializer = new RulesEngine(provider);
    const nodes: SnapshotNode[] = [];
    for (const rule of rules) {
      const materialized = await materializer.materializeRule(tab.id, rule).catch(() => [] as SnapshotNode[]);
      nodes.push(...materialized);
    }

    const deduped = dedupeSnapshotNodes(nodes);
    const refMap = assignRefsAndBuildMap({ nodes: deduped, tabId: tab.id, url: currentUrl, page: pageKey, provider: "camofox" });
    const rendered = renderCamofoxLikeYaml(deduped);
    const continuation = rendered.length > CONTINUATION_CHUNK_CHARS
      ? this.continuationStore.create(currentUrl, rendered, refMap)
      : undefined;

    return this.sliceSnapshot(tab.id, currentUrl, rendered, refMap, input.offset ?? 0, continuation?.id);
  }

  async click(input: BrowserClickInput): Promise<BrowserClickResult> {
    try {
      const provider = await this.providerRouter.getProvider();
      const tab = await this.getCurrentOrSpecifiedTab(provider, input.tabId);
      const beforeUrl = tab.url;
      const target = await this.resolveActionTarget(provider, tab, input.target);
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
      const target = input.target ? await this.resolveActionTarget(provider, tab, input.target) : undefined;
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
      const target = input.target ? await this.resolveActionTarget(provider, tab, input.target) : undefined;
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
        start: boundaryLocatorFromCandidate(input.candidate),
        end: input.endCandidate ? boundaryLocatorFromCandidate(input.endCandidate) : { role: "heading", occurrence: 2 },
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
    if (!input.customSelector && boundary !== "self" && provider.deriveAncestorSelector && occurrence) {
      const levels = boundary === "parent" ? 1 : boundary === "parent+1" ? 2 : boundary === "parent+2" ? 3 : 0;
      selector = (await provider.deriveAncestorSelector({ tabId: occurrence.tabId, selector: input.candidate.selector, levels })) ?? selector;
    }

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
      createdFrom: {
        candidateLabel: input.candidate.label,
        candidateRole: input.candidate.role,
        candidateSelector: input.candidate.selector,
        boundary,
        createdAtUrl: occurrence?.url ?? "",
      },
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
    const nodes = await new RulesEngine(provider).materializeRule(tab.id, rule);
    return renderCamofoxLikeYaml(dedupeSnapshotNodes(nodes));
  }

  async previewCandidateSubtree(candidate: SelectorCandidate, boundary: "self" | "parent" | "parent+1" | "parent+2" | "custom", customSelector?: string): Promise<string> {
    const provider = await this.providerRouter.getProvider();
    const occurrence = candidate.occurrences[0];
    if (!occurrence) return "";
    let selector = customSelector || candidate.selector;
    if (!customSelector && boundary !== "self" && provider.deriveAncestorSelector) {
      const levels = boundary === "parent" ? 1 : boundary === "parent+1" ? 2 : boundary === "parent+2" ? 3 : 0;
      selector = (await provider.deriveAncestorSelector({ tabId: occurrence.tabId, selector: candidate.selector, levels })) ?? selector;
    }
    const elements = await provider.resolveSelector({ tabId: occurrence.tabId, selector });
    const nodes: SnapshotNode[] = [];
    for (const element of elements.slice(0, 5)) nodes.push(await provider.materializeElement({ tabId: occurrence.tabId, element, includeChildren: true }));
    return renderCamofoxLikeYaml(nodes);
  }

  private sliceSnapshot(tabId: string, url: string, text: string, refMap: ReturnType<typeof assignRefsAndBuildMap>, offset: number, continuationId?: string): BrowserSnapshotResult {
    const safeOffset = Math.max(0, offset || 0);
    const chunk = text.slice(safeOffset, safeOffset + CONTINUATION_CHUNK_CHARS);
    const hasMore = safeOffset + CONTINUATION_CHUNK_CHARS < text.length;
    const filteredMap = filterRefMapToRenderedText(refMap, chunk);
    this.refMapStore.save(tabId, filteredMap);
    return {
      url,
      snapshot: chunk,
      refsCount: countRefs(chunk),
      truncated: hasMore,
      totalChars: text.length,
      hasMore,
      nextOffset: hasMore ? safeOffset + CONTINUATION_CHUNK_CHARS : undefined,
      continuationId: hasMore ? continuationId ?? this.continuationStore.create(url, text, refMap).id : continuationId,
    };
  }

  private async resolveActionTarget(provider: BrowserProvider, tab: TabInfo, target: ActionTarget | { selector: string }): Promise<ProviderTarget> {
    const refMap = this.refMapStore.get(tab.id);
    if (!refMap) throw new BrowserToolError("ref_not_visible");

    if ("ref" in target) {
      const entry = refMap.entries[target.ref];
      if (!entry) throw new BrowserToolError("ref_not_visible");
      if (entry.url !== tab.url) throw new BrowserToolError("stale_ref");
      if (!entry.actionAllowed) throw new BrowserToolError("action_not_allowed");
      if (entry.providerRef) return { ref: entry.providerRef };
      if (entry.selector) return { selector: entry.selector };
      throw new BrowserToolError("action_not_allowed");
    }

    if ("selector" in target) {
      const exact = Object.values(refMap.entries).find((entry) => entry.selector === target.selector && entry.url === tab.url && entry.actionAllowed);
      if (exact) return exact.providerRef ? { ref: exact.providerRef } : { selector: exact.selector };
      if (refMap.url !== tab.url) throw new BrowserToolError("stale_ref");
      const resolved = provider.validateSelectorInAreas
        ? await provider.validateSelectorInAreas({ tabId: tab.id, selector: target.selector, areaSelectors: refMap.areaSelectors })
        : undefined;
      if (!resolved) throw new BrowserToolError("selector_not_visible");
      return resolved;
    }

    if ("text" in target) {
      if (refMap.url !== tab.url) throw new BrowserToolError("stale_ref");
      const wanted = normalizeLabel(target.text);
      const exact = Object.values(refMap.entries).find((entry) =>
        entry.url === tab.url && entry.actionAllowed && normalizeLabel(entry.text).includes(wanted),
      );
      if (exact) return exact.providerRef ? { ref: exact.providerRef } : { selector: exact.selector };
      const resolved = provider.validateSelectorInAreas
        ? await provider.validateSelectorInAreas({ tabId: tab.id, text: target.text, areaSelectors: refMap.areaSelectors })
        : undefined;
      if (!resolved) throw new BrowserToolError("text_not_visible");
      return resolved;
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
