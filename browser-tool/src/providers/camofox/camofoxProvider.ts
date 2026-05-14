import type {
  ActionResult,
  BrowserCapabilities,
  BrowserProvider,
  CreateTabInput,
  InternalEvaluateInput,
  MaterializeElementInput,
  NavigateInput,
  NavigationResult,
  ProviderClickInput,
  ProviderPressInput,
  ProviderScrollInput,
  ProviderTarget,
  ProviderTypeInput,
  RawSnapshotInput,
  RawSnapshotResult,
  ResolvedElement,
  ResolveSelectorInput,
  SelectorCandidate,
  SnapshotNode,
  TabInfo,
} from "../../core/types";
import { BrowserToolError } from "../../core/errors";
import { buildPageKey } from "../../core/pageMatcher";
import { CamofoxClient } from "./camofoxClient";
import { mapTab } from "./camofoxMapper";
import { parseCamofoxLikeYaml } from "./camofoxSnapshotParser";

export type CamofoxProviderOptions = {
  userId: string;
  sessionKey: string;
};

export class CamofoxProvider implements BrowserProvider {
  readonly name = "camofox";
  readonly capabilities: BrowserCapabilities = {
    snapshots: true,
    accessibilityRefs: true,
    cssSelectors: true,
    screenshots: true,
    jsEvaluate: true,
    structuredExtract: true,
    authenticatedSession: true,
  };

  constructor(private readonly client: CamofoxClient, private readonly options: CamofoxProviderOptions) {}

  async createTab(input: CreateTabInput): Promise<TabInfo> {
    const response = await this.client.post<{ tabId?: string; url?: string }>("/tabs", {
      userId: this.options.userId,
      sessionKey: this.options.sessionKey,
      listItemId: this.options.sessionKey,
      url: input.url,
      trace: input.trace,
    });
    const id = response.tabId;
    if (!id) throw new BrowserToolError("provider_error", "camofox did not return tabId");
    const tab = await this.getTab(id).catch(() => undefined);
    return tab ?? { id, url: response.url ?? input.url ?? "about:blank" };
  }

  async listTabs(_input?: Record<string, never>): Promise<TabInfo[]> {
    const response = await this.client.get<{ tabs?: unknown[] }>("/tabs", { userId: this.options.userId });
    return (response.tabs ?? []).map((tab) => mapTab(tab as Parameters<typeof mapTab>[0])).filter((tab) => tab.id);
  }

  async getTab(tabId: string): Promise<TabInfo | undefined> {
    return (await this.listTabs({})).find((tab) => tab.id === tabId);
  }

  async navigate(input: NavigateInput): Promise<NavigationResult> {
    if (input.action === "url") {
      if (!input.url) throw new BrowserToolError("navigation_failed", "URL is required for browser_navigate action=url.");
      await this.client.post(`/tabs/${encodeURIComponent(input.tabId)}/navigate`, {
        userId: this.options.userId,
        url: input.url,
        sessionKey: this.options.sessionKey,
        listItemId: this.options.sessionKey,
      });
    } else if (input.action === "back") {
      await this.client.post(`/tabs/${encodeURIComponent(input.tabId)}/back`, { userId: this.options.userId });
    } else if (input.action === "forward") {
      await this.client.post(`/tabs/${encodeURIComponent(input.tabId)}/forward`, { userId: this.options.userId });
    } else if (input.action === "reload") {
      await this.client.post(`/tabs/${encodeURIComponent(input.tabId)}/refresh`, { userId: this.options.userId });
    }

    const tab = await this.getTab(input.tabId);
    return { ok: true, tabId: input.tabId, url: tab?.url ?? input.url ?? "about:blank", title: tab?.title };
  }

  async getRawSnapshot(input: RawSnapshotInput): Promise<RawSnapshotResult> {
    const response = await this.client.get<RawSnapshotResult>(`/tabs/${encodeURIComponent(input.tabId)}/snapshot`, {
      userId: this.options.userId,
      format: "text",
      offset: input.offset,
      includeScreenshot: input.includeScreenshot ? "true" : undefined,
    });
    return {
      url: response.url ?? (await this.getTab(input.tabId))?.url ?? "about:blank",
      snapshot: response.snapshot ?? "",
      refsCount: response.refsCount ?? 0,
      truncated: response.truncated ?? false,
      totalChars: response.totalChars,
      hasMore: response.hasMore ?? false,
      nextOffset: response.nextOffset,
    };
  }

  async getSnapshotTree(tabId: string): Promise<SnapshotNode[]> {
    const chunks: string[] = [];
    let offset = 0;
    for (let i = 0; i < 50; i++) {
      const raw = await this.getRawSnapshot({ tabId, offset });
      chunks.push(raw.snapshot ?? "");
      if (!raw.hasMore) break;
      const nextOffset = raw.nextOffset ?? offset + (raw.snapshot ?? "").length;
      if (nextOffset <= offset) break;
      offset = nextOffset;
    }
    return parseCamofoxLikeYaml(chunks.join(""));
  }

  async resolveSelector(input: ResolveSelectorInput): Promise<ResolvedElement[]> {
    return this.internalEvaluate<ResolvedElement[]>({
      tabId: input.tabId,
      expression: makeResolveSelectorExpression(input.selector),
    }).catch(() => [] as ResolvedElement[]);
  }

  async materializeElement(input: MaterializeElementInput): Promise<SnapshotNode> {
    const nodes = await this.internalEvaluate<SnapshotNode[]>({
      tabId: input.tabId,
      expression: makeMaterializeSelectorExpression(input.element.selector, input.element.index),
    }).catch(() => [] as SnapshotNode[]);
    const node = nodes?.[0] ?? { role: "group", selector: input.element.selector, children: [] };
    tagRule(node, input.ruleId);
    return node;
  }

  async collectCandidates(tabId: string): Promise<SelectorCandidate[]> {
    const tab = await this.getTab(tabId);
    const page = buildPageKey(tab?.url ?? "about:blank");
    const candidates = (await this.internalEvaluate<Array<Omit<SelectorCandidate, "page" | "occurrences"> & { ref?: string; selectorIndex?: number }>>({
      tabId,
      expression: CANDIDATES_EXPRESSION,
    }).catch(() => [] as Array<Omit<SelectorCandidate, "page" | "occurrences"> & { ref?: string; selectorIndex?: number }>)) ?? [];
    return candidates.map((candidate, index) => ({
      ...candidate,
      id: candidate.id || `cand_${tabId}_${index}`,
      page,
      occurrences: [
        {
          id: `occ_${tabId}_${index}`,
          tabId,
          url: tab?.url ?? "about:blank",
          title: tab?.title,
          ref: candidate.ref,
          selector: candidate.selector,
          selectorIndex: candidate.selectorIndex,
          visible: true,
        },
      ],
    }));
  }

  async deriveAncestorSelector(input: { tabId: string; selector: string; levels: number; occurrenceIndex?: number }): Promise<string | undefined> {
    const result = await this.internalEvaluate<{ selector?: string }>({
      tabId: input.tabId,
      expression: makeAncestorSelectorExpression(input.selector, input.levels, input.occurrenceIndex ?? 0),
    });
    return result.selector;
  }

  async validateSelectorInAreas(input: { tabId: string; selector?: string; text?: string; areaSelectors: string[] }): Promise<ProviderTarget | undefined> {
    const result = await this.internalEvaluate<{ selector?: string } | undefined>({
      tabId: input.tabId,
      expression: makeValidateInAreasExpression(input.selector, input.text, input.areaSelectors),
    });
    return result?.selector ? { selector: result.selector } : undefined;
  }

  async click(input: ProviderClickInput): Promise<ActionResult> {
    const body: Record<string, unknown> = {
      userId: this.options.userId,
      doubleClick: input.clickCount === 2,
    };
    assignTarget(body, input.target);
    await this.client.post(`/tabs/${encodeURIComponent(input.tabId)}/click`, body);
    return { ok: true };
  }

  async type(input: ProviderTypeInput): Promise<ActionResult> {
    const body: Record<string, unknown> = {
      userId: this.options.userId,
      text: input.text,
      clear: input.clear,
      submit: input.submit,
    };
    if (input.target) assignTarget(body, input.target);
    await this.client.post(`/tabs/${encodeURIComponent(input.tabId)}/type`, body);
    return { ok: true };
  }

  async press(input: ProviderPressInput): Promise<ActionResult> {
    await this.client.post(`/tabs/${encodeURIComponent(input.tabId)}/press`, {
      userId: this.options.userId,
      key: input.key,
    });
    return { ok: true };
  }

  async scroll(input: ProviderScrollInput): Promise<ActionResult> {
    if (input.target?.selector) {
      await this.internalEvaluate({
        tabId: input.tabId,
        expression: makeScrollSelectorExpression(input.target.selector, input.direction, input.amount ?? 800),
      });
      return { ok: true };
    }
    if (input.direction === "left" || input.direction === "right") {
      await this.internalEvaluate({
        tabId: input.tabId,
        expression: makeScrollWindowExpression(input.direction, input.amount ?? 800),
      });
      return { ok: true };
    }
    await this.client.post(`/tabs/${encodeURIComponent(input.tabId)}/scroll`, {
      userId: this.options.userId,
      direction: input.direction,
      amount: input.amount ?? 800,
    });
    return { ok: true };
  }

  async internalEvaluate<T>(input: InternalEvaluateInput): Promise<T> {
    const response = await this.client.post<{ ok?: boolean; result?: T }>(`/tabs/${encodeURIComponent(input.tabId)}/evaluate`, {
      userId: this.options.userId,
      expression: input.expression,
    });
    return response.result as T;
  }
}

function assignTarget(body: Record<string, unknown>, target: ProviderTarget): void {
  if (target.ref) body.ref = target.ref;
  else if (target.selector) body.selector = target.selector;
  else if (target.text !== undefined) throw new BrowserToolError("provider_error", "Text targets must be resolved to a concrete selector before reaching CamofoxProvider.");
}

function tagRule(node: SnapshotNode, ruleId?: string): void {
  if (ruleId) node.ruleId = ruleId;
  for (const child of node.children ?? []) tagRule(child, ruleId);
}

function makeResolveSelectorExpression(selector: string): string {
  return wrapDomHelpers(`
    const selector = ${JSON.stringify(selector)};
    const matches = queryAllSmart(selector).filter(isVisible);
    return matches.map((el, index) => ({ selector, index, text: visibleText(el).slice(0, 200), role: inferRole(el), visible: true }));
  `);
}

function makeMaterializeSelectorExpression(selector: string, index: number): string {
  return wrapDomHelpers(`
    const selector = ${JSON.stringify(selector)};
    const index = ${JSON.stringify(index)};
    const el = queryAllSmart(selector).filter(isVisible)[index];
    return el ? [nodeFromElement(el, true)] : [];
  `);
}

function makeAncestorSelectorExpression(selector: string, levels: number, occurrenceIndex: number): string {
  return wrapDomHelpers(`
    const selector = ${JSON.stringify(selector)};
    const matches = queryAllSmart(selector).filter(isVisible);
    const occurrenceIndex = Math.max(0, Number(${JSON.stringify(occurrenceIndex)}) || 0);
    const el = matches[occurrenceIndex] || matches[0];
    return { selector: el ? deriveRuleSelector(el, ${JSON.stringify(levels)}) : undefined };
  `);
}

function makeValidateInAreasExpression(selector: string | undefined, text: string | undefined, areaSelectors: string[]): string {
  return wrapDomHelpers(`
    const selector = ${JSON.stringify(selector)};
    const text = ${JSON.stringify(text)};
    const areaSelectors = ${JSON.stringify(areaSelectors)};
    const areas = areaSelectors.length ? areaSelectors.flatMap((s) => queryAllSmart(s)) : [];
    const candidates = selector ? queryAllSmart(selector) : allElements().filter((el) => visibleText(el).toLowerCase().includes(String(text || '').toLowerCase()));
    for (const candidate of candidates) {
      if (!isVisible(candidate)) continue;
      if (areas.some((area) => area === candidate || area.contains(candidate))) return { selector: uniqueSelector(candidate) };
    }
    return undefined;
  `);
}

function makeScrollSelectorExpression(selector: string, direction: string, amount: number): string {
  return wrapDomHelpers(`
    const el = queryAllSmart(${JSON.stringify(selector)}).filter(isVisible)[0];
    if (!el) return { ok: false };
    const amount = ${JSON.stringify(amount)};
    const direction = ${JSON.stringify(direction)};
    const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
    el.scrollBy({ left: dx, top: dy, behavior: 'instant' });
    return { ok: true };
  `);
}

function makeScrollWindowExpression(direction: string, amount: number): string {
  return wrapDomHelpers(`
    const amount = ${JSON.stringify(amount)};
    const direction = ${JSON.stringify(direction)};
    const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
    window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
    return { ok: true };
  `);
}

const CANDIDATES_EXPRESSION = wrapDomHelpers(`
  const out = [];
  for (const el of allElements()) {
    if (!isVisible(el) || !isCandidateElement(el)) continue;
    const role = inferRole(el);
    const kind = candidateKind(el, role);
    if (!kind) continue;
    const label = labelFor(el, role);
    if (!label && !['input','textarea','select','form','table','list','region'].includes(kind)) continue;
    const selector = reusableSelector(el);
    if (!selector) continue;
    const selectorIndex = selectorIndexForElement(el, selector);
    out.push({
      id: 'cand_' + out.length,
      label: label || selector,
      role: role === 'heading' ? 'heading:' + headingLevel(el) : role,
      kind,
      selector,
      selectorIndex,
      selectorQuality: selectorQuality(selector),
      text: visibleText(el).slice(0, 500),
      ariaLabel: el.getAttribute('aria-label') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      href: el instanceof HTMLAnchorElement ? el.getAttribute('href') || undefined : undefined,
      source: 'dom'
    });
  }
  return out.slice(0, 1000);
`);

function wrapDomHelpers(body: string): string {
  return `(() => {
    const MAX_CHILDREN = 80;
    const MAX_DEPTH = 5;

    function cssEscape(value) {
      if (window.CSS && CSS.escape) return CSS.escape(value);
      return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\\\' + ch);
    }

    function allElements() { return Array.from(document.querySelectorAll('body *')); }

    function queryAllSmart(selector) {
      if (!selector) return [];
      try { return Array.from(document.querySelectorAll(selector)); } catch { return []; }
    }

    function isVisible(el) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function visibleText(el) { return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim(); }

    function ownText(el) {
      let text = '';
      for (const child of Array.from(el.childNodes)) if (child.nodeType === Node.TEXT_NODE) text += child.textContent || '';
      return text.replace(/\\s+/g, ' ').trim();
    }

    function inferRole(el) {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') return 'heading';
      if (tag === 'p') return 'paragraph';
      if (tag === 'ul' || tag === 'ol') return 'list';
      if (tag === 'li') return 'listitem';
      if (tag === 'img') return 'img';
      if (tag === 'strong' || tag === 'b') return 'strong';
      if (tag === 'em' || tag === 'i') return 'emphasis';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'button') return 'button';
        return 'textbox';
      }
      if (tag === 'form') return 'form';
      if (tag === 'table') return 'table';
      if (tag === 'main') return 'main';
      if (tag === 'article') return 'article';
      if (tag === 'section' || tag === 'nav' || tag === 'aside') return 'region';
      return 'group';
    }

    function headingLevel(el) {
      const aria = el.getAttribute('aria-level');
      if (aria) return Number(aria) || undefined;
      const match = el.tagName.match(/^H([1-6])$/i);
      return match ? Number(match[1]) : undefined;
    }

    function labelFor(el, role) {
      const aria = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt');
      if (aria) return aria.replace(/\\s+/g, ' ').trim();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.placeholder || el.name || el.value || visibleText(el);
      if (role === 'img') return el.getAttribute('alt') || '';
      return visibleText(el) || ownText(el);
    }

    function isAccessibleElement(el) {
      const role = inferRole(el);
      if (role !== 'group') return true;
      const text = ownText(el);
      return text.length > 0 && text.length < 500;
    }

    function isCandidateElement(el) {
      const tag = el.tagName.toLowerCase();
      const role = inferRole(el);
      return ['button','link','heading','paragraph','list','listitem','textbox','combobox','checkbox','form','table','main','article','region'].includes(role)
        || ['input','textarea','select','form','table','main','article','section','ul','ol','p'].includes(tag);
    }

    function candidateKind(el, role) {
      const tag = el.tagName.toLowerCase();
      if (role === 'button') return 'button';
      if (role === 'link') return 'link';
      if (role === 'heading') return 'heading';
      if (role === 'paragraph') return 'paragraph';
      if (role === 'list') return 'list';
      if (role === 'textbox' || role === 'combobox' || tag === 'input') return tag === 'textarea' ? 'textarea' : 'input';
      if (tag === 'textarea') return 'textarea';
      if (tag === 'select') return 'select';
      if (tag === 'form') return 'form';
      if (tag === 'table') return 'table';
      if (['main','article','region'].includes(role) || ['main','article','section'].includes(tag)) return 'region';
      if (ownText(el)) return 'text';
      return undefined;
    }

    function reusableSelector(el) {
      return attributeSelector(el, false) || idSelector(el) || classSelector(el, false);
    }

    function uniqueSelector(el) {
      return attributeSelector(el, true) || idSelector(el) || classSelector(el, true);
    }

    function attributeSelector(el, requireUnique) {
      const tag = el.tagName.toLowerCase();
      const attrs = ['data-testid', 'data-test', 'data-qa', 'aria-label', 'name', 'type', 'placeholder', 'href'];
      for (const attr of attrs) {
        const value = el.getAttribute(attr);
        if (!value || value.length > 160) continue;
        const selector = tag + '[' + attr + '=' + JSON.stringify(value) + ']';
        if (!requireUnique || selectorIsUnique(selector)) return selector;
      }
      return undefined;
    }

    function idSelector(el) {
      if (!el.id || /[0-9a-f]{8,}|^ember|^react|^headlessui/i.test(el.id)) return undefined;
      const selector = '#' + cssEscape(el.id);
      return selectorIsUnique(selector) ? selector : undefined;
    }

    function classSelector(el, requireUnique) {
      const tag = el.tagName.toLowerCase();
      const classes = Array.from(el.classList || []).filter(isReusableClassName).slice(0, 3);
      if (!classes.length) return undefined;
      const selector = tag + classes.map((c) => '.' + cssEscape(c)).join('');
      if (!requireUnique || selectorIsUnique(selector)) return selector;
      return undefined;
    }

    function isReusableClassName(value) {
      return Boolean(value)
        && !/[0-9a-f]{6,}/i.test(value)
        && !/^css-|^sc-|active|selected/i.test(value)
        && !/___/.test(value)
        && !/--[A-Za-z0-9_-]{5,}$/.test(value);
    }

    function selectorIsUnique(selector) {
      try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
    }

    function selectorMatchesElement(el, selector) {
      return queryAllSmart(selector).includes(el);
    }

    function selectorIndexForElement(el, selector) {
      const index = queryAllSmart(selector).filter(isVisible).indexOf(el);
      return index >= 0 ? index : undefined;
    }

    function deriveRuleSelector(el, levels) {
      let ancestor = el;
      let remaining = Math.max(0, Number(levels) || 0);
      while (ancestor && remaining > 0 && ancestor.parentElement && ancestor.parentElement !== document.body) {
        ancestor = ancestor.parentElement;
        remaining--;
      }
      if (!ancestor) return undefined;

      const exact = ruleSelectorForAncestor(ancestor, el);
      if (exact) return exact;
      if (levels <= 0) return undefined;

      let node = ancestor.parentElement;
      while (node && node !== document.body) {
        const selector = reusableSelector(node);
        if (selector) return selector;
        node = node.parentElement;
      }
      return undefined;
    }

    function ruleSelectorForAncestor(ancestor, descendant) {
      const ownStrong = attributeSelector(ancestor, false) || idSelector(ancestor);
      if (ownStrong) return ownStrong;
      if (ancestor === descendant) return classSelector(ancestor, false);

      const leafSelector = reusableSelector(descendant);
      if (leafSelector) {
        const childPath = directChildPathSelector(ancestor, descendant, leafSelector);
        if (childPath) {
          const selector = ancestor.tagName.toLowerCase() + ':has(' + childPath + ')';
          if (selectorMatchesElement(ancestor, selector)) return selector;
        }
      }

      return classSelector(ancestor, false);
    }

    function directChildPathSelector(ancestor, descendant, leafSelector) {
      const segments = [];
      let node = descendant;
      while (node && node !== ancestor) {
        segments.unshift(node === descendant ? leafSelector : node.tagName.toLowerCase());
        node = node.parentElement;
      }
      if (node !== ancestor || segments.length === 0) return undefined;
      return '> ' + segments.join(' > ');
    }


    function selectorQuality(selector) {
      if (/data-testid|data-test|data-qa|aria-label|^#[^ >]+$/.test(selector)) return 'stable';
      return 'ok';
    }

    function nodeFromElement(el, includeChildren, depth = 0) {
      const role = inferRole(el);
      const label = labelFor(el, role);
      const node = {
        role,
        name: ['button','link','heading','img','checkbox','radio','combobox','textbox'].includes(role) ? label || undefined : undefined,
        text: ['text','paragraph','listitem','strong','emphasis'].includes(role) || (role === 'group' && ownText(el)) ? (ownText(el) || label || undefined) : undefined,
        selector: uniqueSelector(el),
        url: el instanceof HTMLAnchorElement ? el.getAttribute('href') || undefined : undefined,
        level: role === 'heading' ? headingLevel(el) : undefined,
        actionAllowed: ['button','link','textbox','combobox','checkbox','radio','menuitem'].includes(role) || el.hasAttribute('contenteditable'),
        children: []
      };
      if (node.url) node.children.push({ role: '/url', url: node.url, actionAllowed: false });
      if (includeChildren && depth < MAX_DEPTH) {
        for (const child of Array.from(el.children).slice(0, MAX_CHILDREN)) {
          if (!isVisible(child) || !isAccessibleElement(child)) continue;
          const childNode = nodeFromElement(child, true, depth + 1);
          if (childNode.name || childNode.text || (childNode.children && childNode.children.length) || childNode.role !== 'group') node.children.push(childNode);
        }
      }
      if (!node.children.length) delete node.children;
      return node;
    }

    ${body}
  })()`;
}
