import type { BrowserProvider, BrowserRule, BoundaryLocator, RangeRule, SnapshotNode, SubtreeRule } from "./types";
import { normalizeLabel } from "./utils";

export class RulesEngine {
  constructor(private readonly provider: BrowserProvider) {}

  async materializeRule(tabId: string, rule: BrowserRule): Promise<SnapshotNode[]> {
    if (rule.kind === "subtree") return this.materializeSubtreeRule(tabId, rule);
    return this.materializeRangeRule(tabId, rule);
  }

  async materializeSubtreeRule(tabId: string, rule: SubtreeRule): Promise<SnapshotNode[]> {
    const elements = await this.provider.resolveSelector({
      tabId,
      selector: rule.selector,
    });

    const nodes: SnapshotNode[] = [];
    for (const element of elements) {
      const node = await this.provider.materializeElement({ tabId, element, includeChildren: true, ruleId: rule.id });
      tagNode(node, rule.id, "subtree");
      node.isAreaRoot = true;
      node.actionAllowed = true;
      nodes.push(node);
    }
    return nodes;
  }

  async materializeRangeRule(tabId: string, rule: RangeRule): Promise<SnapshotNode[]> {
    if (!this.provider.getDocumentOrderAccessibleNodes) return [];
    const docOrderNodes = await this.provider.getDocumentOrderAccessibleNodes(tabId);
    const startIndex = findBoundaryIndex(docOrderNodes, rule.start);
    const endIndex = findBoundaryIndex(docOrderNodes, rule.end, startIndex + 1);

    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) return [];

    const from = rule.includeStart ? startIndex : startIndex + 1;
    const to = rule.includeEnd ? endIndex + 1 : endIndex;
    const sliced = docOrderNodes.slice(from, to);
    for (const node of sliced) tagNode(node, rule.id, "range");
    return sliced;
  }
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
  if (boundary.selector && node.selector === boundary.selector) return true;

  if (boundary.role && !roleMatches(node, boundary.role)) return false;
  if (boundary.headingLevel && node.level !== boundary.headingLevel) return false;

  const nodeText = normalizeLabel(node.name ?? node.text);
  const boundaryText = normalizeLabel(boundary.text);

  if (boundary.text && boundary.role) {
    return nodeText === boundaryText || nodeText.includes(boundaryText) || boundaryText.includes(nodeText);
  }
  if (boundary.text) return nodeText === boundaryText || nodeText.includes(boundaryText);
  if (boundary.role) return true;
  return false;
}

function roleMatches(node: SnapshotNode, role: string): boolean {
  if (role === node.role) return true;
  if (role.startsWith("heading") && node.role === "heading") return true;
  if (role === "input" && ["textbox", "combobox", "checkbox"].includes(node.role)) return true;
  return false;
}
