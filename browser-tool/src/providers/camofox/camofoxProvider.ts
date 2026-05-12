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

  async resolveSelector(input: ResolveSelectorInput): Promise<ResolvedElement[]> {
    const selectors = [input.selector, ...(input.fallbackSelectors ?? [])].filter(Boolean);
    for (const selector of selectors) {
      const elements = await this.internalEvaluate<ResolvedElement[]>({
        tabId: input.tabId,
        expression: makeResolveSelectorExpression(selector),
      }).catch(() => [] as ResolvedElement[]);
      if (elements.length) return elements;
    }
    return [];
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

  async getDocumentOrderAccessibleNodes(tabId: string): Promise<SnapshotNode[]> {
    return (await this.internalEvaluate<SnapshotNode[]>({ tabId, expression: DOCUMENT_ORDER_EXPRESSION }).catch(() => [] as SnapshotNode[])) ?? [];
  }

  async collectCandidates(tabId: string): Promise<SelectorCandidate[]> {
    const tab = await this.getTab(tabId);
    const page = buildPageKey(tab?.url ?? "about:blank");
    const candidates = (await this.internalEvaluate<Array<Omit<SelectorCandidate, "page" | "occurrences"> & { ref?: string }>>({
      tabId,
      expression: CANDIDATES_EXPRESSION,
    }).catch(() => [] as Array<Omit<SelectorCandidate, "page" | "occurrences"> & { ref?: string }>)) ?? [];
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
          visible: true,
        },
      ],
    }));
  }

  async deriveAncestorSelector(input: { tabId: string; selector: string; levels: number }): Promise<string | undefined> {
    const result = await this.internalEvaluate<{ selector?: string }>({
      tabId: input.tabId,
      expression: makeAncestorSelectorExpression(input.selector, input.levels),
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
  else if (target.text) body.selector = textSelectorFallback(target.text);
}

function textSelectorFallback(text: string): string {
  return `text=${text}`;
}

function tagRule(node: SnapshotNode, ruleId?: string): void {
  if (ruleId) node.ruleId = ruleId;
  for (const child of node.children ?? []) tagRule(child, ruleId);
}

function makeResolveSelectorExpression(selector: string): string {
  return wrapDomHelpers(`
    const selector = ${JSON.stringify(selector)};
    const matches = queryAllSmart(selector).filter(isVisible);
    return matches.map((el) => ({ selector: uniqueSelector(el), index: 0, text: visibleText(el).slice(0, 200), role: inferRole(el), visible: true }));
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

function makeAncestorSelectorExpression(selector: string, levels: number): string {
  return wrapDomHelpers(`
    let el = queryAllSmart(${JSON.stringify(selector)}).filter(isVisible)[0];
    let levels = ${JSON.stringify(levels)};
    while (el && levels > 0 && el.parentElement && el.parentElement !== document.body) { el = el.parentElement; levels--; }
    return { selector: el ? reusableSelector(el) : undefined };
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

const DOCUMENT_ORDER_EXPRESSION = wrapDomHelpers(`
  return allElements()
    .filter((el) => isVisible(el) && isAccessibleElement(el))
    .map((el) => nodeFromElement(el, false))
    .filter((node) => node.name || node.text || node.role !== 'group');
`);

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
    out.push({
      id: 'cand_' + out.length,
      label: label || selector,
      role: role === 'heading' ? 'heading:' + headingLevel(el) : role,
      kind,
      selector,
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
      try { return Array.from(document.querySelectorAll(selector)); } catch {}
      const textMatch = String(selector).match(/^(.*):has-text\\(["']?(.+?)["']?\\)$/);
      if (textMatch) {
        const base = textMatch[1] || '*';
        const text = textMatch[2].toLowerCase();
        try { return Array.from(document.querySelectorAll(base)).filter((el) => visibleText(el).toLowerCase().includes(text)); } catch { return []; }
      }
      if (String(selector).startsWith('text=')) {
        const text = String(selector).slice(5).toLowerCase();
        return allElements().filter((el) => visibleText(el).toLowerCase().includes(text));
      }
      return [];
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
      const tag = el.tagName.toLowerCase();
      const stableAttrs = ['data-testid', 'data-test', 'data-qa', 'aria-label'];
      for (const attr of stableAttrs) {
        const value = el.getAttribute(attr);
        if (value) return tag + '[' + attr + '=' + JSON.stringify(value) + ']';
      }
      for (const attr of ['name', 'type', 'placeholder', 'href']) {
        const value = el.getAttribute(attr);
        if (value && value.length < 120) return tag + '[' + attr + '=' + JSON.stringify(value) + ']';
      }
      const text = labelFor(el, inferRole(el));
      if (text && text.length < 80 && ['button','a','h1','h2','h3','label'].includes(tag)) return tag + ':has-text(' + JSON.stringify(text) + ')';
      return uniqueSelector(el);
    }

    function uniqueSelector(el) {
      const stableAttrs = ['data-testid', 'data-test', 'data-qa', 'aria-label'];
      for (const attr of stableAttrs) {
        const value = el.getAttribute(attr);
        if (value) {
          const selector = el.tagName.toLowerCase() + '[' + attr + '=' + JSON.stringify(value) + ']';
          try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
        }
      }
      if (el.id && !/[0-9a-f]{8,}|^ember|^react|^headlessui/i.test(el.id)) {
        const selector = '#' + cssEscape(el.id);
        try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
      }
      const tag = el.tagName.toLowerCase();
      for (const attr of ['name', 'type', 'placeholder', 'href']) {
        const value = el.getAttribute(attr);
        if (value && value.length < 120) {
          const selector = tag + '[' + attr + '=' + JSON.stringify(value) + ']';
          try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
        }
      }
      const text = labelFor(el, inferRole(el));
      if (text && text.length < 80 && ['button','a','h1','h2','h3'].includes(tag)) {
        const same = Array.from(document.querySelectorAll(tag)).filter((node) => labelFor(node, inferRole(node)) === text);
        if (same.length === 1) return tag + ':has-text(' + JSON.stringify(text) + ')';
      }
      const classes = Array.from(el.classList || []).filter((c) => !/[0-9a-f]{6,}|^css-|^sc-|active|selected/i.test(c)).slice(0, 3);
      if (classes.length) {
        const selector = tag + classes.map((c) => '.' + cssEscape(c)).join('');
        try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
      }
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
        const parent = node.parentElement;
        const nodeTag = node.tagName.toLowerCase();
        if (!parent) { parts.unshift(nodeTag); break; }
        const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        const nth = siblings.indexOf(node) + 1;
        parts.unshift(nodeTag + ':nth-of-type(' + nth + ')');
        node = parent;
      }
      return parts.join(' > ');
    }

    function selectorQuality(selector) {
      if (/data-testid|data-test|data-qa|aria-label|^#[^ >]+$/.test(selector)) return 'stable';
      if (/:nth-of-type|:nth-child/.test(selector)) return 'fragile';
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
