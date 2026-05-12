import type { TabInfo } from "../../core/types";

export type CamofoxTab = {
  tabId?: string;
  targetId?: string;
  url?: string;
  title?: string;
  listItemId?: string;
};

export function mapTab(tab: CamofoxTab): TabInfo {
  return {
    id: tab.tabId || tab.targetId || "",
    targetId: tab.targetId,
    url: tab.url || "about:blank",
    title: tab.title,
    sessionKey: tab.listItemId,
  };
}
