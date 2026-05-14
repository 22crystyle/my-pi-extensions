import type { SnapshotNode } from "./types";
import { normalizeLabel, normalizeWhitespace } from "./utils";

export type SnapshotFlatEntry = {
  node: SnapshotNode;
  index: number;
  depth: number;
  path: number[];
};

export type IndexedSnapshotEntry = SnapshotFlatEntry & {
  endIndex: number;
};

export type VisibilityInterval = {
  from: number;
  to: number;
  ruleId: string;
  source: "range" | "subtree";
  rootIndex?: number;
  selector?: string;
  specificity?: number;
};

export function dedupeSnapshotNodes(nodes: SnapshotNode[]): SnapshotNode[] {
  const seen = new Set<string>();
  const result: SnapshotNode[] = [];
  for (const node of nodes) {
    const key = snapshotNodeKey(node);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(node);
  }
  return result;
}

export function snapshotNodeKey(node: SnapshotNode): string {
  return [
    node.sourceKey,
    node.selector,
    node.providerRef,
    node.role,
    normalizeWhitespace(node.name ?? node.text),
    node.url,
    (node.children ?? []).map(snapshotNodeKey).join(";"),
  ].filter(Boolean).join("|");
}

export function flattenSnapshotNodes(nodes: SnapshotNode[]): SnapshotNode[] {
  return flattenSnapshotTree(nodes).map((entry) => entry.node);
}

export function indexSnapshotTree(nodes: SnapshotNode[]): IndexedSnapshotEntry[] {
  const out: IndexedSnapshotEntry[] = [];
  const visit = (node: SnapshotNode, depth: number, path: number[]): number => {
    const entry: IndexedSnapshotEntry = { node, index: out.length, depth, path, endIndex: out.length + 1 };
    out.push(entry);
    for (const [childIndex, child] of (node.children ?? []).entries()) visit(child, depth + 1, [...path, childIndex]);
    entry.endIndex = out.length;
    return entry.endIndex;
  };
  nodes.forEach((node, index) => visit(node, 0, [index]));
  return out;
}

export function flattenSnapshotTree(nodes: SnapshotNode[]): SnapshotFlatEntry[] {
  const out: SnapshotFlatEntry[] = [];
  const visit = (node: SnapshotNode, depth: number, path: number[]) => {
    out.push({ node, index: out.length, depth, path });
    (node.children ?? []).forEach((child, childIndex) => visit(child, depth + 1, [...path, childIndex]));
  };
  nodes.forEach((node, index) => visit(node, 0, [index]));
  return out;
}

export function clipSnapshotTreeByPreorderRange(nodes: SnapshotNode[], fromInclusive: number, toExclusive: number): SnapshotNode[] {
  let index = 0;

  const visit = (node: SnapshotNode): SnapshotNode | undefined => {
    const ownIndex = index++;
    const children = node.children ?? [];
    const clippedChildren = children.map(visit).filter((child): child is SnapshotNode => Boolean(child));
    const ownIncluded = ownIndex >= fromInclusive && ownIndex < toExclusive;

    if (!ownIncluded && clippedChildren.length === 0) return undefined;

    const clone: SnapshotNode = { ...node };
    if (clippedChildren.length) clone.children = clippedChildren;
    else delete clone.children;
    return clone;
  };

  return nodes.map(visit).filter((node): node is SnapshotNode => Boolean(node));
}

export function projectSnapshotTreeByIntervals(nodes: SnapshotNode[], intervals: VisibilityInterval[]): SnapshotNode[] {
  if (intervals.length === 0) return [];

  const covered = new Map<number, VisibilityInterval>();
  const subtreeRoots = new Map<number, VisibilityInterval>();
  const rangeCovered = new Set<number>();

  const choose = (current: VisibilityInterval | undefined, next: VisibilityInterval): VisibilityInterval => {
    if (!current) return next;
    const currentScore = current.specificity ?? 0;
    const nextScore = next.specificity ?? 0;
    if (nextScore !== currentScore) return nextScore > currentScore ? next : current;
    if (current.source !== next.source) return next.source === "subtree" ? next : current;
    return current;
  };

  for (const interval of intervals) {
    const from = Math.max(0, interval.from);
    const to = Math.max(from, interval.to);
    if (interval.source === "subtree" && interval.rootIndex !== undefined) subtreeRoots.set(interval.rootIndex, interval);
    for (let i = from; i < to; i++) {
      covered.set(i, choose(covered.get(i), interval));
      if (interval.source === "range") rangeCovered.add(i);
    }
  }

  let index = 0;
  const visit = (node: SnapshotNode): SnapshotNode[] => {
    const ownIndex = index++;
    const childResults: SnapshotNode[] = [];
    for (const child of node.children ?? []) childResults.push(...visit(child));

    const interval = covered.get(ownIndex);
    const subtreeRoot = subtreeRoots.get(ownIndex);
    const ownIncluded = Boolean(interval);
    const structuralRangeAncestor = !ownIncluded && childResults.length > 0 && hasRangeDescendant(childResults);

    if (!ownIncluded && !structuralRangeAncestor) return childResults;

    const clone: SnapshotNode = { ...node };
    if (childResults.length) clone.children = childResults;
    else delete clone.children;

    if (interval && !clone.ruleId) clone.ruleId = interval.ruleId;
    if (interval && !clone.source) clone.source = interval.source;
    if (subtreeRoot) {
      clone.ruleId = subtreeRoot.ruleId;
      clone.source = "subtree";
      clone.selector = subtreeRoot.selector ?? clone.selector;
      clone.isAreaRoot = true;
      clone.actionAllowed = true;
    }
    if (rangeCovered.has(ownIndex)) clone.source = "range";

    return [clone];
  };

  return nodes.flatMap(visit);
}

function hasRangeDescendant(nodes: SnapshotNode[]): boolean {
  const stack = [...nodes];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.source === "range") return true;
    stack.push(...(node.children ?? []));
  }
  return false;
}

export function findBestSnapshotMatch(input: {
  entries: IndexedSnapshotEntry[];
  role?: string;
  text?: string;
  name?: string;
  url?: string;
  startAt?: number;
  used?: Set<number>;
}): IndexedSnapshotEntry | undefined {
  const startAt = Math.max(0, input.startAt ?? 0);
  const passes = [startAt, 0];
  for (const start of passes) {
    let best: { entry: IndexedSnapshotEntry; score: number } | undefined;
    for (let i = start; i < input.entries.length; i++) {
      if (input.used?.has(i)) continue;
      const entry = input.entries[i];
      const score = snapshotMatchScore(entry.node, input);
      if (score <= 0) continue;
      if (!best || score > best.score) best = { entry, score };
      if (score >= 100) break;
    }
    if (best) return best.entry;
  }
  return undefined;
}

function snapshotMatchScore(node: SnapshotNode, input: { role?: string; text?: string; name?: string; url?: string }): number {
  let score = 0;
  if (input.role) {
    if (!snapshotRoleMatches(node.role, input.role)) return 0;
    score += 20;
  }

  if (input.url) {
    if (!snapshotUrlMatches(node, input.url)) return 0;
    score += 40;
  }

  const wanted = normalizeLabel(input.name ?? input.text);
  if (wanted) {
    const actual = normalizeLabel(node.name ?? node.text);
    if (!actual) return 0;
    if (actual === wanted) score += 50;
    else if (actual.includes(wanted)) score += 35;
    else if (wanted.includes(actual) && actual.length >= 80 && actual.length / wanted.length >= 0.5) score += 25;
    else {
      const overlap = tokenOverlap(actual, wanted);
      if (overlap < 0.45) return 0;
      score += Math.round(overlap * 25);
    }
  }

  return score;
}

function snapshotRoleMatches(snapshotRole: string, elementRole: string): boolean {
  if (snapshotRole === elementRole) return true;
  if (elementRole === "input" && ["textbox", "combobox", "checkbox", "radio"].includes(snapshotRole)) return true;
  if (snapshotRole === "textbox" && elementRole === "input") return true;
  return false;
}

function snapshotUrlMatches(node: SnapshotNode, wantedUrl: string): boolean {
  const urls = [node.url, ...(node.children ?? []).filter((child) => child.role === "/url").map((child) => child.url)].filter(Boolean) as string[];
  return urls.some((url) => urlsEquivalent(url, wantedUrl));
}

function urlsEquivalent(left: string, right: string): boolean {
  if (left === right) return true;
  try {
    const l = new URL(left, "https://dummy.local");
    const r = new URL(right, "https://dummy.local");
    return l.pathname === r.pathname && l.search === r.search && (l.hostname === "dummy.local" || r.hostname === "dummy.local" || l.hostname === r.hostname);
  } catch {
    return left === right || left.endsWith(right) || right.endsWith(left);
  }
}

function tokenOverlap(actual: string, wanted: string): number {
  const a = new Set(actual.split(/\s+/).filter((token) => token.length > 2));
  const w = wanted.split(/\s+/).filter((token) => token.length > 2);
  if (a.size === 0 || w.length === 0) return 0;
  let hit = 0;
  for (const token of w) if (a.has(token)) hit++;
  return hit / w.length;
}
