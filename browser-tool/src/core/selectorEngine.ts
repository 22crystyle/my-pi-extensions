import type { SelectorCandidate } from "./types";
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

export function boundaryLocatorFromCandidate(candidate: SelectorCandidate) {
  const occurrence = 1;
  if (candidate.kind === "heading") {
    const match = candidate.role?.match(/heading:(\d+)/);
    return {
      role: "heading",
      headingLevel: match ? Number(match[1]) : undefined,
      text: candidate.label,
      selector: candidate.selector,
      occurrence,
    };
  }
  return {
    role: candidate.role,
    text: candidate.label,
    selector: candidate.selector,
    occurrence,
  };
}
