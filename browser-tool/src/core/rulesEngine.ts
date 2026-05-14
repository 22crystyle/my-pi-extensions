import type { BrowserProvider, BrowserRule, BoundaryLocator, RangeRule, ResolvedElement, SnapshotNode, SubtreeRule } from "./types";
import {
  findBestSnapshotMatch,
  flattenSnapshotTree,
  indexSnapshotTree,
  projectSnapshotTreeByIntervals,
  type IndexedSnapshotEntry,
  type VisibilityInterval,
} from "./snapshotMaterializer";
import { normalizeLabel } from "./utils";

export class RulesEngine {
  constructor(private readonly provider: BrowserProvider) {}

  async materializeRule(tabId: string, rule: BrowserRule): Promise<SnapshotNode[]> {
    return this.materializeRules(tabId, [rule]);
  }

  async materializeRules(tabId: string, rules: BrowserRule[]): Promise<SnapshotNode[]> {
    if (!this.provider.getSnapshotTree) return [];
    const tree = await this.provider.getSnapshotTree(tabId);
    const entries = indexSnapshotTree(tree);
    const intervals: VisibilityInterval[] = [];

    for (const rule of rules) {
      if (rule.kind === "subtree") {
        intervals.push(...await this.subtreeIntervals(tabId, rule, entries));
      } else {
        const interval = this.rangeInterval(rule, entries);
        if (interval) intervals.push(interval);
      }
    }

    return projectSnapshotTreeByIntervals(tree, normalizeIntervals(intervals));
  }

  async materializeSubtreeRule(tabId: string, rule: SubtreeRule): Promise<SnapshotNode[]> {
    return this.materializeRules(tabId, [rule]);
  }

  async materializeRangeRule(tabId: string, rule: RangeRule): Promise<SnapshotNode[]> {
    return this.materializeRules(tabId, [rule]);
  }

  private async subtreeIntervals(tabId: string, rule: SubtreeRule, entries: IndexedSnapshotEntry[]): Promise<VisibilityInterval[]> {
    const elements = await this.provider.resolveSelector({ tabId, selector: rule.selector });
    const used = new Set<number>();
    const intervals: VisibilityInterval[] = [];
    let cursor = 0;

    for (const element of elements) {
      const match = locateElement(entries, element, cursor, used);
      if (!match) continue;
      used.add(match.index);
      cursor = match.index + 1;
      intervals.push({
        from: match.index,
        to: match.endIndex,
        rootIndex: match.index,
        ruleId: rule.id,
        source: "subtree",
        selector: rule.selector,
        specificity: pageSpecificity(rule.page),
      });
    }

    return intervals;
  }

  private rangeInterval(rule: RangeRule, entries: IndexedSnapshotEntry[]): VisibilityInterval | undefined {
    const flatNodes = entries.map((entry) => entry.node);
    const startIndex = findBoundaryIndex(flatNodes, rule.start);
    const endIndex = findBoundaryIndex(flatNodes, rule.end, startIndex + 1);

    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) return undefined;

    const from = rule.includeStart ? startIndex : startIndex + 1;
    const to = rule.includeEnd ? endIndex + 1 : endIndex;
    return { from, to, ruleId: rule.id, source: "range", specificity: pageSpecificity(rule.page) };
  }
}

function locateElement(entries: IndexedSnapshotEntry[], element: ResolvedElement, cursor: number, used: Set<number>): IndexedSnapshotEntry | undefined {
  const byUrlAndName = findBestSnapshotMatch({
    entries,
    role: element.role,
    name: element.name,
    text: element.text,
    url: element.url,
    startAt: cursor,
    used,
  });
  if (byUrlAndName) return byUrlAndName;

  return findBestSnapshotMatch({
    entries,
    role: element.role,
    name: element.name,
    text: element.text,
    startAt: cursor,
    used,
  });
}

function normalizeIntervals(intervals: VisibilityInterval[]): VisibilityInterval[] {
  return intervals
    .filter((interval) => interval.to > interval.from)
    .sort((left, right) => left.from - right.from || right.to - left.to || (right.specificity ?? 0) - (left.specificity ?? 0));
}

function pageSpecificity(page: { host: string; path: string; query?: unknown; hash?: unknown }): number {
  let score = 0;
  if (page.host && page.host !== "*" && page.host !== "all") score += page.host.startsWith("*.") ? 200 : 300;
  if (page.path && page.path !== "*" && page.path !== "/*") {
    if (page.path.endsWith("/*")) score += 150;
    else if (page.path.includes(":id") || page.path.includes(":hash")) score += 250;
    else score += 300;
  }
  if (page.query && page.query !== "ignore") score += 30;
  if (page.hash && page.hash !== "ignore") score += 10;
  return score;
}

export function tagNode(node: SnapshotNode, ruleId: string, source: "range" | "subtree"): void {
  node.ruleId = ruleId;
  node.source = source;
  for (const child of node.children ?? []) tagNode(child, ruleId, source);
}

export function findBoundaryIndex(nodes: SnapshotNode[], boundary: BoundaryLocator, startAt = 0): number {
  const occurrence = Math.max(1, boundary.occurrence ?? 1);
  let seen = 0;

  for (let i = Math.max(0, startAt); i < nodes.length; i++) {
    if (matchesBoundary(nodes[i], boundary)) {
      seen += 1;
      if (seen === occurrence) return i;
    }
  }
  return -1;
}

function matchesBoundary(node: SnapshotNode, boundary: BoundaryLocator): boolean {
  const mode = boundary.match ?? "all";
  const selectorMatches = Boolean(boundary.selector && node.selector === boundary.selector);
  const structureMatches = (!boundary.role || roleMatches(node, boundary.role))
    && (!boundary.headingLevel || node.level === boundary.headingLevel);
  const textMatches = boundaryTextMatches(node, boundary);

  if (mode === "selector") return selectorMatches;
  if (mode === "structure") return structureMatches;
  if (mode === "text") return structureMatches && textMatches;

  if (boundary.selector && !selectorMatches) return false;
  if (!structureMatches) return false;
  if (boundary.text && !textMatches) return false;
  return Boolean(boundary.selector || boundary.role || boundary.headingLevel || boundary.text);
}

function boundaryTextMatches(node: SnapshotNode, boundary: BoundaryLocator): boolean {
  if (!boundary.text) return true;
  const nodeText = normalizeLabel(node.name ?? node.text);
  const boundaryText = normalizeLabel(boundary.text);
  return Boolean(boundaryText && (nodeText === boundaryText || nodeText.includes(boundaryText) || boundaryText.includes(nodeText)));
}

function roleMatches(node: SnapshotNode, role: string): boolean {
  if (role === node.role) return true;
  if (role.startsWith("heading") && node.role === "heading") return true;
  if (role === "input" && ["textbox", "combobox", "checkbox"].includes(node.role)) return true;
  return false;
}
