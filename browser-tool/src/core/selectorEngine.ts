import type { BoundaryLocator, SelectorCandidate } from "./types";
import { normalizeLabel } from "./utils";
import { pageMatcherKey } from "./pageMatcher";

export function candidateGroupingKey(candidate: SelectorCandidate): string {
  return [
    pageMatcherKey(candidate.page),
    candidate.kind,
    candidate.role ?? "",
    normalizeLabel(candidate.label),
    normalizeSelectorForGrouping(candidate.selector),
  ].join("|");
}

export function normalizeSelectorForGrouping(selector: string): string {
  return selector
    .replace(/:nth-of-type\(\d+\)/g, ":nth-of-type(n)")
    .replace(/:nth-child\(\d+\)/g, ":nth-child(n)")
    .replace(/\s+/g, " ")
    .trim();
}

export type BoundaryLocatorOptions = {
  includeSelector?: boolean;
  includeText?: boolean;
  match?: BoundaryLocator["match"];
};

export function boundaryLocatorFromCandidate(candidate: SelectorCandidate, options: BoundaryLocatorOptions = {}): BoundaryLocator {
  const occurrence = 1;
  const includeSelector = options.includeSelector ?? true;
  const includeText = options.includeText ?? true;
  if (candidate.kind === "heading") {
    const match = candidate.role?.match(/heading:(\d+)/);
    return compactBoundary({
      role: "heading",
      headingLevel: match ? Number(match[1]) : undefined,
      text: includeText ? candidate.label : undefined,
      selector: includeSelector ? candidate.selector : undefined,
      occurrence,
      match: options.match,
    });
  }
  return compactBoundary({
    role: candidate.role,
    text: includeText ? candidate.label : undefined,
    selector: includeSelector ? candidate.selector : undefined,
    occurrence,
    match: options.match,
  });
}

export function rangeStartBoundaryLocatorFromCandidate(candidate: SelectorCandidate): BoundaryLocator {
  const headingLevel = candidate.kind === "heading" ? Number(candidate.role?.match(/heading:(\d+)/)?.[1] ?? 0) : undefined;
  if (headingLevel === 1) {
    return boundaryLocatorFromCandidate(candidate, { includeSelector: false, includeText: false, match: "structure" });
  }
  return boundaryLocatorFromCandidate(candidate, { includeSelector: false, includeText: true, match: "text" });
}

export function rangeEndBoundaryLocatorFromCandidate(candidate: SelectorCandidate): BoundaryLocator {
  return boundaryLocatorFromCandidate(candidate, { includeSelector: false, includeText: true, match: "text" });
}

function compactBoundary(boundary: BoundaryLocator): BoundaryLocator {
  if (!boundary.selector) delete boundary.selector;
  if (!boundary.text) delete boundary.text;
  if (!boundary.role) delete boundary.role;
  if (!boundary.headingLevel) delete boundary.headingLevel;
  if (!boundary.match) delete boundary.match;
  return boundary;
}
