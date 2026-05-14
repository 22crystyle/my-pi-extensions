import type { SnapshotNode } from "./types";
import { normalizeWhitespace } from "./utils";

export type SnapshotFlatEntry = {
  node: SnapshotNode;
  index: number;
  depth: number;
  path: number[];
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
