import type { PageMatcher, RefMap, RefMapEntry, SnapshotNode } from "./types";

export class RefMapStore {
  private maps = new Map<string, RefMap>();

  save(tabId: string, refMap: RefMap): void {
    this.maps.set(tabId, refMap);
  }

  get(tabId: string): RefMap | undefined {
    return this.maps.get(tabId);
  }

  clear(tabId?: string): void {
    if (tabId) this.maps.delete(tabId);
    else this.maps.clear();
  }
}

export function assignRefsAndBuildMap(input: {
  nodes: SnapshotNode[];
  tabId: string;
  url: string;
  page: PageMatcher;
  provider: "camofox";
  visibleText?: string;
}): RefMap {
  const entries: Record<string, RefMapEntry> = {};
  const areaSelectors: string[] = [];
  let providerCounter = 1;
  let rangeCounter = 1;

  const used = new Set<string>();
  const nextSyntheticRef = (node: SnapshotNode): string => {
    const prefix = node.source === "range" ? "r" : "p";
    let ref: string;
    if (prefix === "r") {
      do ref = `r${rangeCounter++}`; while (used.has(ref));
    } else {
      do ref = `p${providerCounter++}`; while (used.has(ref));
    }
    return ref;
  };

  const visit = (node: SnapshotNode, inheritedRuleId?: string) => {
    const providerRef = node.providerRef ?? (node.ref?.startsWith("e") ? node.ref : undefined);
    const hasTarget = Boolean(providerRef || node.selector);
    const shouldHaveRef = hasTarget && node.role !== "/url";
    const ruleId = node.ruleId ?? inheritedRuleId ?? "unknown";

    if (shouldHaveRef) {
      let publicRef = providerRef ?? node.ref;
      if (!publicRef || used.has(publicRef)) publicRef = nextSyntheticRef(node);
      used.add(publicRef);
      node.ref = publicRef;
      node.providerRef = providerRef;

      const entry: RefMapEntry = {
        publicRef,
        provider: input.provider,
        providerRef,
        selector: node.selector,
        text: node.name ?? node.text,
        role: node.role,
        tabId: input.tabId,
        url: input.url,
        page: input.page,
        ruleId,
        actionAllowed: node.actionAllowed !== false,
        isAreaRoot: node.isAreaRoot,
      };
      entries[publicRef] = entry;
      if (node.isAreaRoot && node.selector) areaSelectors.push(node.selector);
    }

    for (const child of node.children ?? []) visit(child, ruleId);
  };

  for (const node of input.nodes) visit(node);

  return {
    tabId: input.tabId,
    url: input.url,
    page: input.page,
    entries,
    areaSelectors: Array.from(new Set(areaSelectors)),
  };
}

export function filterRefMapToRenderedText(refMap: RefMap, renderedText: string): RefMap {
  const entries: Record<string, RefMapEntry> = {};
  for (const [ref, entry] of Object.entries(refMap.entries)) {
    if (renderedText.includes(`[${ref}]`)) entries[ref] = entry;
  }
  const visibleAreaSelectors = refMap.areaSelectors.filter((selector) =>
    Object.values(entries).some((entry) => entry.selector === selector || entry.isAreaRoot),
  );
  return { ...refMap, entries, areaSelectors: visibleAreaSelectors };
}

export function countRefs(renderedText: string): number {
  return new Set(Array.from(renderedText.matchAll(/\[([epr]\d+)\]/g)).map((m) => m[1])).size;
}
