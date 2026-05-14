export type WaitUntil = "none" | "domcontentloaded" | "load" | "networkidle";

export type BrowserNavigateInput = {
  tabId?: string;
  action: "url" | "back" | "forward" | "reload" | "new_tab" | "switch_tab";
  url?: string;
  tabTarget?: string;
  waitUntil?: WaitUntil;
};

export type BrowserNavigateResult = {
  ok: boolean;
  tabId: string;
  url: string;
  title?: string;
  error?: string;
  message?: string;
};

export type BrowserSnapshotInput = {
  tabId?: string;
  offset?: number;
  includeScreenshot?: boolean;
  continuationId?: string;
};

export type BrowserSnapshotResult = {
  url: string;
  snapshot: string;
  refsCount: number;
  truncated?: boolean;
  totalChars?: number;
  hasMore?: boolean;
  nextOffset?: number;
  continuationId?: string;
};

export type ActionTarget = { ref: string } | { selector: string } | { text: string };

export type BrowserClickInput = {
  tabId?: string;
  target: ActionTarget;
  button?: "left" | "right" | "middle";
  clickCount?: 1 | 2;
  waitAfter?: boolean;
};

export type BrowserClickResult = {
  ok: boolean;
  tabId: string;
  url?: string;
  navigation?: boolean;
  error?: string;
  message?: string;
};

export type BrowserTypeInput = {
  tabId?: string;
  target?: { ref: string } | { selector: string };
  text: string;
  clear?: boolean;
  submit?: boolean;
};

export type BrowserTypeResult = {
  ok: boolean;
  tabId: string;
  url?: string;
  error?: string;
  message?: string;
};

export type BrowserPressInput = {
  tabId?: string;
  key: string;
};

export type BrowserPressResult = {
  ok: boolean;
  tabId: string;
  url?: string;
  error?: string;
  message?: string;
};

export type BrowserScrollInput = {
  tabId?: string;
  target?: { ref: string } | { selector: string };
  direction: "up" | "down" | "left" | "right";
  amount?: "small" | "medium" | "large" | number;
};

export type BrowserScrollResult = {
  ok: boolean;
  tabId: string;
  url?: string;
  error?: string;
  message?: string;
};

export type BrowserCapabilities = {
  snapshots: boolean;
  accessibilityRefs: boolean;
  cssSelectors: boolean;
  screenshots: boolean;
  jsEvaluate: boolean;
  structuredExtract: boolean;
  authenticatedSession: boolean;
};

export type CreateTabInput = { url?: string; trace?: boolean };
export type ListTabsInput = Record<string, never>;
export type TabRef = { id: string; url: string; title?: string };
export type TabInfo = { id: string; targetId?: string; url: string; title?: string; sessionKey?: string };

export type NavigateInput = {
  tabId: string;
  action: "url" | "back" | "forward" | "reload";
  url?: string;
  waitUntil?: WaitUntil;
};

export type NavigationResult = { ok: boolean; tabId: string; url: string; title?: string };

export type RawSnapshotInput = {
  tabId: string;
  offset?: number;
  includeScreenshot?: boolean;
};

export type RawSnapshotResult = BrowserSnapshotResult;

export type ResolveSelectorInput = { tabId: string; selector: string };
export type ResolvedElement = { selector: string; index: number; text?: string; role?: string; visible?: boolean };

export type MaterializeElementInput = { tabId: string; element: ResolvedElement; includeChildren: boolean; ruleId?: string };

export type ProviderTarget = { ref?: string; selector?: string; text?: string };

export type ProviderClickInput = {
  tabId: string;
  target: ProviderTarget;
  button?: "left" | "right" | "middle";
  clickCount?: 1 | 2;
  waitAfter?: boolean;
};

export type ProviderTypeInput = {
  tabId: string;
  target?: ProviderTarget;
  text: string;
  clear?: boolean;
  submit?: boolean;
};

export type ProviderPressInput = { tabId: string; key: string };
export type ProviderScrollInput = { tabId: string; target?: ProviderTarget; direction: "up" | "down" | "left" | "right"; amount?: number };
export type ActionResult = { ok: boolean; url?: string; navigation?: boolean };
export type InternalEvaluateInput = { tabId: string; expression: string };

export type SnapshotNode = {
  role: string;
  name?: string;
  text?: string;
  ref?: string;
  providerRef?: string;
  selector?: string;
  url?: string;
  level?: number;
  attrs?: Record<string, string | number | boolean | undefined>;
  children?: SnapshotNode[];
  actionAllowed?: boolean;
  ruleId?: string;
  source?: "raw" | "dom" | "range" | "subtree";
  sourceKey?: string;
  isAreaRoot?: boolean;
};

export interface BrowserProvider {
  name: string;
  capabilities: BrowserCapabilities;

  createTab(input: CreateTabInput): Promise<TabRef>;
  listTabs(input?: ListTabsInput): Promise<TabInfo[]>;
  getTab?(tabId: string): Promise<TabInfo | undefined>;
  navigate(input: NavigateInput): Promise<NavigationResult>;

  getRawSnapshot(input: RawSnapshotInput): Promise<RawSnapshotResult>;
  getSnapshotTree?(tabId: string): Promise<SnapshotNode[]>;
  resolveSelector(input: ResolveSelectorInput): Promise<ResolvedElement[]>;
  materializeElement(input: MaterializeElementInput): Promise<SnapshotNode>;
  collectCandidates?(tabId: string): Promise<SelectorCandidate[]>;
  deriveAncestorSelector?(input: { tabId: string; selector: string; levels: number; occurrenceIndex?: number }): Promise<string | undefined>;
  validateSelectorInAreas?(input: { tabId: string; selector?: string; text?: string; areaSelectors: string[] }): Promise<ProviderTarget | undefined>;

  click(input: ProviderClickInput): Promise<ActionResult>;
  type(input: ProviderTypeInput): Promise<ActionResult>;
  press(input: ProviderPressInput): Promise<ActionResult>;
  scroll(input: ProviderScrollInput): Promise<ActionResult>;

  internalEvaluate?<T>(input: InternalEvaluateInput): Promise<T>;
}

export type PageMatcher = {
  host: string;
  path: string;
  query?: "ignore" | "exact" | Record<string, string>;
  hash?: "ignore" | "exact";
};

export type BrowserRule = SubtreeRule | RangeRule;

export type BaseRule = {
  id: string;
  enabled: boolean;
  name: string;
  page: PageMatcher;
  source: "candidate" | "manual";
  createdAt: string;
  updatedAt: string;
};

export type SubtreeRule = BaseRule & {
  kind: "subtree";
  selector: string;
};

export type BoundaryLocator = {
  selector?: string;
  text?: string;
  role?: string;
  headingLevel?: number;
  occurrence?: number;
  match?: "all" | "selector" | "text" | "structure";
};

export type RangeRule = BaseRule & {
  kind: "range";
  start: BoundaryLocator;
  end: BoundaryLocator;
  includeStart: boolean;
  includeEnd: boolean;
};

export type SelectorCandidate = {
  id: string;
  page: PageMatcher;
  label: string;
  role?: string;
  kind:
    | "button"
    | "link"
    | "input"
    | "textarea"
    | "select"
    | "form"
    | "table"
    | "heading"
    | "paragraph"
    | "text"
    | "list"
    | "region";
  selector: string;
  selectorQuality: "stable" | "ok";
  text?: string;
  ariaLabel?: string;
  placeholder?: string;
  href?: string;
  occurrences: CandidateOccurrence[];
  source: "snapshot" | "links" | "dom";
};

export type CandidateOccurrence = {
  id: string;
  tabId: string;
  url: string;
  title?: string;
  ref?: string;
  selector: string;
  selectorIndex?: number;
  visible: boolean;
  enabled?: boolean;
};

export type RefMapEntry = {
  publicRef: string;
  provider: "camofox";
  providerRef?: string;
  selector?: string;
  text?: string;
  role?: string;
  tabId: string;
  url: string;
  page: PageMatcher;
  ruleId: string;
  actionAllowed: boolean;
  isAreaRoot?: boolean;
};

export type RefMap = {
  tabId: string;
  url: string;
  page: PageMatcher;
  entries: Record<string, RefMapEntry>;
  areaSelectors: string[];
};

export type UiState = {
  version: 1;
  camofoxBaseUrl: string;
  userId: string;
  sessionKey: string;
  debugRawSnapshot: boolean;
  currentTabId?: string;
};
