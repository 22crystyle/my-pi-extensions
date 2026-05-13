import type { BrowserProvider, SelectorCandidate, TabInfo } from "./types";
import { buildPageKey } from "./pageMatcher";
import { candidateGroupingKey } from "./selectorEngine";
import { normalizeWhitespace, randomId } from "./utils";

export class CandidatesEngine {
  constructor(private readonly provider: BrowserProvider) {}

  async collect(): Promise<SelectorCandidate[]> {
    const tabs = await this.provider.listTabs({});
    const grouped = new Map<string, SelectorCandidate>();

    for (const tab of tabs) {
      const candidates = await this.collectFromTab(tab).catch(() => [] as SelectorCandidate[]);
      for (const candidate of candidates) {
        const key = candidateGroupingKey(candidate);
        const existing = grouped.get(key);
        if (!existing) {
          grouped.set(key, candidate);
        } else {
          existing.occurrences.push(...candidate.occurrences);
        }
      }
    }

    return Array.from(grouped.values());
  }

  private async collectFromTab(tab: TabInfo): Promise<SelectorCandidate[]> {
    const page = buildPageKey(tab.url || "about:blank");
    const domCandidates = this.provider.collectCandidates ? await this.provider.collectCandidates(tab.id) : [];
    return domCandidates
      .filter((candidate) => candidate.selector && candidate.label)
      .map((candidate, index) => ({
        ...candidate,
        id: candidate.id || randomId("cand"),
        page: candidate.page ?? page,
        label: normalizeWhitespace(candidate.label),
        occurrences: candidate.occurrences?.length
          ? candidate.occurrences.map((occ, occIndex) => ({
              ...occ,
              id: occ.id || `${tab.id}:${index}:${occIndex}`,
              tabId: occ.tabId || tab.id,
              url: occ.url || tab.url,
              title: occ.title || tab.title,
              selector: occ.selector || candidate.selector,
              visible: occ.visible !== false,
            }))
          : [
              {
                id: `${tab.id}:${index}`,
                tabId: tab.id,
                url: tab.url,
                title: tab.title,
                selector: candidate.selector,
                visible: true,
              },
            ],
      }));
  }
}
