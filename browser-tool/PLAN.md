# One-shot план для ИИ Агента: Browser Tool для pi-coding-agent

## Цель

Реализовать расширяемый browser automation tool для `pi-coding-agent`, который использует `camofox-browser` как первый backend/provider, но не привязывает внешний API агента к camofox. Tool должен позволять агенту навигировать, читать отфильтрованный accessibility snapshot, кликать, печатать, нажимать клавиши и скроллить. Ограничение видимости страницы задаёт пользователь через TUI extension, а не агент.

Главное требование: агент получает snapshot в camofox-like YAML формате, но только по включённым пользовательским Rules. Агент не знает о Rules, Candidates, selectors, page scopes, range boundaries и внутренней логике фильтрации.

---

## Ключевые принципы

1. Не генерировать agent-facing tools напрямую из OpenAPI camofox.
2. Camofox — это provider adapter, а не публичный API агента.
3. Agent-facing API минимальный и стабильный.
4. TUI управляет тем, что попадает в контекст модели.
5. Snapshot для агента — обычный camofox-style YAML, но отфильтрованный.
6. Rules — это выбранные пользователем области видимости, а не инструкции агенту.
7. Candidates — это UI-подсказки для пользователя, не доступные агенту.
8. Одинаковые кандидаты объединяются в один выбор, но с учётом page scope.
9. Одинаковые CSS selectors на разных страницах не конфликтуют, потому что Rule всегда содержит `pageMatcher`.
10. Для карточек и форм используется `subtree` boundary.
11. Для потокового текста используется `range` boundary.
12. Если данных много, они не должны теряться из-за смыслового `maxChars/maxItems`; допустимы технические continuation chunks.
13. `evaluate` не должен быть agent-facing tool. Он может использоваться только внутри provider adapter / collector.

---

## Итоговый набор agent-facing tools

Создать ровно эти tools:

```txt
browser_navigate
browser_snapshot
browser_click
browser_type
browser_press
browser_scroll
```

Не создавать на первом этапе:

```txt
browser_evaluate
browser_extract
browser_links
browser_images
browser_screenshot
browser_wait
browser_open
browser_close
```

`browser_press` обязателен, потому что без него агент плохо работает с Enter, Escape, Tab, dropdown, autocomplete, modal, command palettes и TUI-like интерфейсами.

---

## Agent-facing tools: контракты

### 1. browser_navigate

Назначение: открыть URL, перейти назад/вперёд, обновить страницу, создать или переключить вкладку.

Input:

```ts
type BrowserNavigateInput = {
  tabId?: string;
  action: "url" | "back" | "forward" | "reload" | "new_tab" | "switch_tab";
  url?: string;
  tabTarget?: string;
  waitUntil?: "none" | "domcontentloaded" | "load" | "networkidle";
};
```

Output:

```ts
type BrowserNavigateResult = {
  ok: boolean;
  tabId: string;
  url: string;
  title?: string;
};
```

Important:

* Не возвращать полный snapshot после navigation.
* Если агенту нужен контент, он отдельно вызывает `browser_snapshot`.

---

### 2. browser_snapshot

Назначение: вернуть camofox-like YAML snapshot, отфильтрованный по включённым пользовательским Rules, подходящим текущей странице.

Input:

```ts
type BrowserSnapshotInput = {
  tabId?: string;
  offset?: number;
  includeScreenshot?: boolean;
  continuationId?: string;
};
```

Запрещено добавлять в agent-facing input:

```ts
rules?: unknown;
scope?: unknown;
selector?: string;
maxChars?: number;
maxItems?: number;
```

Output:

```ts
type BrowserSnapshotResult = {
  url: string;
  snapshot: string;
  refsCount: number;
  truncated?: boolean;
  totalChars?: number;
  hasMore?: boolean;
  nextOffset?: number;
  continuationId?: string;
};
```

Important:

* Агент не должен знать, какие Rules применились.
* Если нет подходящих enabled Rules, вернуть пустой snapshot:

```json
{
  "url": "https://example.com",
  "snapshot": "",
  "refsCount": 0,
  "truncated": false,
  "hasMore": false
}
```

* Не объяснять агенту `no rules`, `not allowed`, `filtered by user rules`.
* Snapshot должен быть валидным camofox-like YAML, например:

```yaml
- heading "Junior Devops Engineer" [level=1]
- text: до 100 000 ₽ за месяц, на руки
- button "Откликнуться" [e16]
```

---

### 3. browser_click

Назначение: кликнуть по элементу, который был виден агенту в последнем filtered snapshot.

Input:

```ts
type BrowserClickInput = {
  tabId?: string;
  target: { ref: string } | { selector: string } | { text: string };
  button?: "left" | "right" | "middle";
  clickCount?: 1 | 2;
  waitAfter?: boolean;
};
```

Rules:

* Приоритетно использовать `ref`.
* `selector` и `text` разрешить только если они резолвятся внутрь областей, видимых в последнем snapshot.
* Если ref не был выдан в последнем snapshot или URL изменился, вернуть ошибку `stale_ref` или `ref_not_visible`.

Output:

```ts
type BrowserClickResult = {
  ok: boolean;
  tabId: string;
  url?: string;
  navigation?: boolean;
  error?: string;
};
```

---

### 4. browser_type

Назначение: ввести текст в input/textarea/combobox/contenteditable.

Input:

```ts
type BrowserTypeInput = {
  tabId?: string;
  target?: { ref: string } | { selector: string };
  text: string;
  clear?: boolean;
  submit?: boolean;
};
```

Rules:

* Если `target` отсутствует, печатать в текущий focused element.
* Если `target` есть, валидировать его через last filtered snapshot/ref map.
* `submit: true` может маппиться на Enter после ввода, но `browser_press` всё равно должен существовать отдельно.

---

### 5. browser_press

Назначение: клавиши и hotkeys.

Input:

```ts
type BrowserPressInput = {
  tabId?: string;
  key: string;
};
```

Examples:

```json
{ "key": "Enter" }
{ "key": "Escape" }
{ "key": "Tab" }
{ "key": "Control+L" }
```

---

### 6. browser_scroll

Назначение: скролл страницы или видимой области.

Input:

```ts
type BrowserScrollInput = {
  tabId?: string;
  target?: { ref: string } | { selector: string };
  direction: "up" | "down" | "left" | "right";
  amount?: "small" | "medium" | "large" | number;
};
```

Rules:

* Если target отсутствует, скроллить страницу.
* Если target есть, валидировать через last filtered snapshot/ref map.

---

## Внутренняя архитектура

Реализовать слои:

```txt
pi-coding-agent
  ↓
agent-facing browser tools
  ↓
BrowserToolService
  ↓
RulesEngine + PageMatcher + SnapshotMaterializer + RefMap
  ↓
ProviderRouter
  ↓
CamofoxProvider first; later CDP / Firecrawl / agent-browser
```

Рекомендуемая структура проекта:

```txt
src/
  tools/
    browser_navigate.ts
    browser_snapshot.ts
    browser_click.ts
    browser_type.ts
    browser_press.ts
    browser_scroll.ts

  core/
    types.ts
    browserToolService.ts
    providerRouter.ts
    pageMatcher.ts
    rulesEngine.ts
    candidatesEngine.ts
    selectorEngine.ts
    snapshotMaterializer.ts
    refMap.ts
    continuationStore.ts
    errors.ts

  providers/
    camofox/
      camofoxClient.ts
      camofoxProvider.ts
      camofoxMapper.ts
      camofoxSnapshotParser.ts
      camofoxYamlRenderer.ts

  tui-extension/
    browserPanel.ts
    rulesTab.ts
    candidatesTab.ts
    scopePicker.ts
    rangePicker.ts

  storage/
    rulesStore.ts
    uiStateStore.ts
```

---

## Provider interface

Создать общий provider contract:

```ts
export interface BrowserProvider {
  name: string;
  capabilities: BrowserCapabilities;

  createTab(input: CreateTabInput): Promise<TabRef>;
  listTabs(input: ListTabsInput): Promise<TabInfo[]>;
  navigate(input: NavigateInput): Promise<NavigationResult>;

  getRawSnapshot(input: RawSnapshotInput): Promise<RawSnapshotResult>;
  resolveSelector(input: ResolveSelectorInput): Promise<ResolvedElement[]>;
  materializeElement(input: MaterializeElementInput): Promise<SnapshotNode>;

  click(input: ProviderClickInput): Promise<ActionResult>;
  type(input: ProviderTypeInput): Promise<ActionResult>;
  press(input: ProviderPressInput): Promise<ActionResult>;
  scroll(input: ProviderScrollInput): Promise<ActionResult>;

  internalEvaluate?<T>(input: InternalEvaluateInput): Promise<T>;
}
```

Capabilities:

```ts
type BrowserCapabilities = {
  snapshots: boolean;
  accessibilityRefs: boolean;
  cssSelectors: boolean;
  screenshots: boolean;
  jsEvaluate: boolean;
  structuredExtract: boolean;
  authenticatedSession: boolean;
};
```

CamofoxProvider должен маппиться на endpoints:

```txt
createTab        -> POST /tabs
listTabs         -> GET /tabs
navigate url     -> POST /tabs/{tabId}/navigate
back             -> POST /tabs/{tabId}/back
forward          -> POST /tabs/{tabId}/forward
reload           -> POST /tabs/{tabId}/refresh
getRawSnapshot   -> GET /tabs/{tabId}/snapshot
click            -> POST /tabs/{tabId}/click
type             -> POST /tabs/{tabId}/type
press            -> POST /tabs/{tabId}/press
scroll           -> POST /tabs/{tabId}/scroll
internalEvaluate -> POST /tabs/{tabId}/evaluate
```

`internalEvaluate` не экспонировать агенту.

---

## Rules model

Rule — это выбранная пользователем область видимости. Rule всегда содержит `pageMatcher`.

```ts
type BrowserRule = SubtreeRule | RangeRule;

type BaseRule = {
  id: string;
  enabled: boolean;
  name: string;
  page: PageMatcher;
  source: "candidate" | "manual";
  createdAt: string;
  updatedAt: string;
};

type SubtreeRule = BaseRule & {
  kind: "subtree";
  selector: string;
  fallbackSelectors?: string[];
  createdFrom?: {
    candidateLabel?: string;
    candidateRole?: string;
    candidateSelector?: string;
    boundary: "self" | "parent" | "parent+1" | "parent+2" | "custom";
    createdAtUrl: string;
  };
};

type RangeRule = BaseRule & {
  kind: "range";
  start: BoundaryLocator;
  end: BoundaryLocator;
  includeStart: boolean;
  includeEnd: boolean;
};
```

BoundaryLocator:

```ts
type BoundaryLocator = {
  selector?: string;
  text?: string;
  role?: string;
  headingLevel?: number;
  occurrence?: number;
};
```

PageMatcher:

```ts
type PageMatcher = {
  host: string;
  path: string;
  query?: "ignore" | "exact" | Record<string, string>;
  hash?: "ignore" | "exact";
};
```

Examples:

```json
{
  "kind": "subtree",
  "name": "Область вокруг: Откликнуться",
  "page": {
    "host": "*.hh.ru",
    "path": "/",
    "query": "ignore",
    "hash": "ignore"
  },
  "selector": "div[data-qa='vacancy-serp__vacancy']"
}
```

```json
{
  "kind": "range",
  "name": "Текст вакансии",
  "page": {
    "host": "*.hh.ru",
    "path": "/vacancy/:id",
    "query": "ignore",
    "hash": "ignore"
  },
  "start": {
    "role": "heading",
    "headingLevel": 1,
    "occurrence": 1
  },
  "end": {
    "role": "button",
    "text": "Пожаловаться на вакансию"
  },
  "includeStart": true,
  "includeEnd": false
}
```

---

## Page scope / PageMatcher

Обязательно фильтровать Rules по текущей странице.

Проблема: кнопка `Откликнуться` на главной странице и на странице вакансии может иметь одинаковые selectors. Поэтому ключ Rules и Candidates должен учитывать `pageKey`.

Build page key:

```ts
function buildPageKey(url: string): PageMatcher {
  const u = new URL(url);
  return {
    host: normalizeHost(u.hostname),
    path: normalizePath(u.pathname),
    query: "ignore",
    hash: "ignore"
  };
}
```

Normalize host:

```txt
hh.ru              -> *.hh.ru
spb.hh.ru          -> *.hh.ru
career.hh.ru       -> career.hh.ru unless user chooses broader site scope
example.com        -> example.com
```

Normalize path:

```txt
/                                  -> /
/vacancy/132616454                 -> /vacancy/:id
/search/vacancy?text=devops        -> /search/vacancy
/applicant/resumes                 -> /applicant/resumes
```

Implementation:

```ts
function normalizePath(pathname: string): string {
  return pathname
    .replace(/\/\d+($|\/)/g, "/:id$1")
    .replace(/[a-f0-9]{16,}/gi, ":hash");
}
```

TUI must allow page scope choice:

```txt
Page scope:
> current exact URL
  current route: /vacancy/:id
  current path: /vacancy/*
  whole site: *.hh.ru
  all sites
```

Default:

```txt
if path has numeric id -> current route, e.g. /vacancy/:id
else -> current path
```

---

## Candidates model

Candidates are for TUI only. Agent must never see them.

Candidate:

```ts
type SelectorCandidate = {
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
  selectorQuality: "stable" | "ok" | "fragile";

  text?: string;
  ariaLabel?: string;
  placeholder?: string;
  href?: string;

  occurrences: CandidateOccurrence[];
  source: "snapshot" | "links" | "dom";
};
```

Occurrence:

```ts
type CandidateOccurrence = {
  id: string;
  tabId: string;
  url: string;
  title?: string;
  ref?: string;
  selector: string;
  visible: boolean;
  enabled?: boolean;
};
```

Candidate grouping key:

```txt
pageKey + kind/role + normalizedLabel + normalizedSelector
```

Do not merge candidates globally across pages.

Examples:

```txt
*.hh.ru /:
  Откликнуться: button: button:has-text("Откликнуться")

*.hh.ru /vacancy/:id:
  Откликнуться: button: button:has-text("Откликнуться")
```

They are different candidates because page scope is different.

---

## Candidate collection

Collect from:

1. Raw camofox snapshot.
2. Links endpoint if useful.
3. Internal DOM collector using `internalEvaluate`.

Do not expose internal evaluate to agent.

Candidate collector should find:

```txt
buttons
links
inputs
textareas
comboboxes
selects
forms
tables
headings
paragraph-like blocks
lists
visible text blocks
regions/articles/main sections
```

This is needed because `range` rules require headings, paragraphs, text and buttons as boundaries.

---

## Selector generation priority

Generate stable selectors using this priority:

```txt
1. [data-testid="..."]
2. [data-test="..."]
3. [data-qa="..."]
4. [aria-label="..."]
5. stable id, if not autogenerated
6. name / type / placeholder for form fields
7. href pattern for links
8. role + visible text, if backend supports it
9. stable class combinations
10. :has(...) structural selector
11. nth-child fallback, marked fragile
```

Never show normalized selector as actual rule. Normalization is only for grouping.

---

## TUI extension

TUI must have two tabs:

```txt
Rules
Candidates
```

### Rules tab

Shows selected rules. Everything in Rules is enabled by default.

Example:

```txt
Rules
────────────────────────────────────────────────────────
Page: *.hh.ru /
[x] Область вокруг: Откликнуться
    div[data-qa="vacancy-serp__vacancy"]

[x] Поиск
    button:has-text("Поиск")

Page: *.hh.ru /vacancy/:id
[x] Текст вакансии
    range: heading h1 -> button "Пожаловаться на вакансию"

[x] Откликнуться
    button:has-text("Откликнуться")
```

Keys:

```txt
e      enable/disable all rules
space  enable/disable selected rule
d      delete selected rule
/      fuzzy filter
a      add manual rule
p      preview selected rule
```

Behavior for `e`:

```txt
if at least one visible/selected-scope rule is enabled -> disable all
else -> enable all
```

If implementation supports active filter, decide explicitly:

* Option A: `e` toggles all rules globally.
* Option B: `e` toggles only filtered visible rules.

Prefer Option A for predictability unless product wants batch operations by filter.

### Candidates tab

Shows grouped candidates from all open tabs, grouped by page.

Example:

```txt
Candidates
────────────────────────────────────────────────────────
Page: *.hh.ru /
[+] Откликнуться: button: button:has-text("Откликнуться")   20 matches
[+] Поиск: button: button:has-text("Поиск")
[+] Профессия, должность или компания: combobox: input[name="text"]

Page: *.hh.ru /vacancy/:id
[+] Junior Devops Engineer: heading h1
[+] Откликнуться: button: button:has-text("Откликнуться")   2 matches
[+] Ключевые навыки: heading h2
[+] Задайте вопрос работодателю: heading h2
[+] Где предстоит работать: heading h2
[+] Пожаловаться на вакансию: button
```

Keys:

```txt
/      fuzzy search by label, role, selector, href, tab title, url
Enter  open boundary picker
r      refresh candidates
```

Search is fuzzy, not exact.

---

## Boundary picker

When user selects a Candidate, do not add it directly to Rules. Open boundary picker.

Boundary modes:

```txt
Subtree: self / parent / parent+1 / parent+2 / custom selector
Range: from selected element to another element
Manual
```

### Subtree mode

For cards, forms, modals, tables, rows, isolated blocks.

UI:

```txt
Candidate: Откликнуться: button
────────────────────────────────────────
Boundary mode:
> Subtree
  Range
  Manual

Subtree boundary:
> self
  parent
  parent +1
  parent +2
  custom selector

Preview:
- button "Откликнуться" [e59]

Keys:
↑/↓  change boundary
p    preview all matches
a    add selected area to Rules
```

When user chooses parent+1, preview might show:

```yaml
- group:
  - link "Junior Devops Engineer"
  - text: до 100 000 ₽ за месяц, на руки
  - link "evrone.ru"
  - text: Москва
  - button "Откликнуться"
```

Then add as `SubtreeRule`.

### Range mode

For pages where text is in document flow, not inside a clean DOM subtree.

UI:

```txt
Candidate: heading "Junior Devops Engineer"
────────────────────────────────────────
Boundary mode:
  Subtree
> Range
  Manual

Start:
> heading "Junior Devops Engineer"

End:
  next heading same level
  next heading any level
> button "Пожаловаться на вакансию"
  custom selector/text

Preview:
- heading "Junior Devops Engineer"
- text: до 100 000 ₽ за месяц, на руки
- paragraph: "Выплаты: раз в месяц"
- ...
- button "Откликнуться"
```

Then add as `RangeRule`.

---

## Snapshot materialization

`browser_snapshot` algorithm:

```ts
async function browserSnapshot(input: BrowserSnapshotInput): Promise<BrowserSnapshotResult> {
  const tab = await provider.getCurrentOrSpecifiedTab(input.tabId);
  const currentUrl = tab.url;
  const pageKey = buildPageKey(currentUrl);

  const rules = await rulesStore.getEnabledRulesMatching(pageKey);

  const nodes: SnapshotNode[] = [];

  for (const rule of rules) {
    if (rule.kind === "subtree") {
      nodes.push(...await materializeSubtreeRule(tab.id, rule));
    } else if (rule.kind === "range") {
      nodes.push(...await materializeRangeRule(tab.id, rule));
    }
  }

  const deduped = dedupeSnapshotNodes(nodes);
  const rendered = renderCamofoxLikeYaml(deduped);

  const refMap = buildRefMap(deduped, currentUrl, pageKey);
  await refMapStore.save(tab.id, refMap);

  return {
    url: currentUrl,
    snapshot: rendered.text,
    refsCount: rendered.refsCount,
    truncated: rendered.truncated,
    totalChars: rendered.totalChars,
    hasMore: rendered.hasMore,
    nextOffset: rendered.nextOffset
  };
}
```

Important:

* Do not regex-cut raw snapshot strings if you can avoid it.
* Prefer DOM/accessibility materialization into internal SnapshotNode tree, then render YAML.
* If a provider ref exists, preserve it.
* If no provider ref exists but action is needed, create synthetic ref.

Synthetic refs:

```txt
p1, p2, p3 for provider selector refs
r1, r2, r3 for range nodes
```

Ref map:

```ts
type RefMapEntry = {
  publicRef: string;
  provider: "camofox";
  providerRef?: string;
  selector?: string;
  tabId: string;
  url: string;
  page: PageMatcher;
  ruleId: string;
  actionAllowed: boolean;
};
```

Action tools must validate refs against this map.

---

## Range materialization

RangeRule means: collect accessible/rendered nodes in document order from start boundary to end boundary.

Pseudo:

```ts
async function materializeRangeRule(tabId: string, rule: RangeRule): Promise<SnapshotNode[]> {
  const docOrderNodes = await provider.getDocumentOrderAccessibleNodes(tabId);

  const startIndex = findBoundaryIndex(docOrderNodes, rule.start);
  const endIndex = findBoundaryIndex(docOrderNodes, rule.end);

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    return [];
  }

  const from = rule.includeStart ? startIndex : startIndex + 1;
  const to = rule.includeEnd ? endIndex + 1 : endIndex;

  return docOrderNodes.slice(from, to);
}
```

Boundary matching priority:

```txt
1. selector + occurrence
2. role + exact text + headingLevel + occurrence
3. role + fuzzy text + occurrence
4. text-only + occurrence
```

For vacancy page example:

```txt
start: heading h1 occurrence 1
end: button "Пожаловаться на вакансию"
includeStart: true
includeEnd: false
```

Result should include vacancy title, salary, paragraphs, lists, skills, questions, location, apply buttons, but exclude complaint button and reviews.

---

## Subtree materialization

SubtreeRule means: resolve selector, render each matched subtree as camofox-like YAML.

Pseudo:

```ts
async function materializeSubtreeRule(tabId: string, rule: SubtreeRule): Promise<SnapshotNode[]> {
  const elements = await provider.resolveSelector({
    tabId,
    selector: rule.selector,
    fallbackSelectors: rule.fallbackSelectors
  });

  const nodes: SnapshotNode[] = [];

  for (const element of elements) {
    nodes.push(await provider.materializeElement({
      tabId,
      element,
      includeChildren: true
    }));
  }

  return nodes;
}
```

For main HH listing page, user may select `parent+1` around `Откликнуться`, producing a subtree for each vacancy card-like area.

---

## YAML rendering

Renderer must produce camofox-like text:

```yaml
- link "Резюме и профиль 56" [e4]:
  - /url: /applicant/resumes?hhtmFrom=vacancy&hhtmFromLabel=header
- heading "Junior Devops Engineer" [level=1]
- button "Откликнуться" [e16]
```

Rules:

* Preserve refs when available.
* Preserve common roles: link, button, heading, text, paragraph, list, listitem, checkbox, combobox, group, img.
* Use `group [syntheticRef]` only when materializing an area container that has no better accessible role.
* Do not expose rule names, page matchers, selector names or candidate metadata in snapshot.

---

## Ref validation for actions

Action tools must only operate on refs visible in last filtered snapshot.

Algorithm:

```ts
async function resolveActionTarget(tabId: string, target: ActionTarget): Promise<ProviderTarget> {
  const tab = await provider.getTab(tabId);
  const refMap = await refMapStore.get(tabId);

  if (target.ref) {
    const entry = refMap[target.ref];
    if (!entry) throw new BrowserToolError("ref_not_visible");
    if (entry.url !== tab.url) throw new BrowserToolError("stale_ref");
    if (!entry.actionAllowed) throw new BrowserToolError("action_not_allowed");
    return mapEntryToProviderTarget(entry);
  }

  if (target.selector || target.text) {
    // Must resolve within allowed visible snapshot areas only.
    return resolveWithinVisibleAreas(tabId, target, refMap);
  }

  throw new BrowserToolError("invalid_target");
}
```

Errors returned to agent should not mention rules:

```json
{
  "ok": false,
  "error": "ref_not_visible",
  "message": "The target is not present in the current browser snapshot."
}
```

```json
{
  "ok": false,
  "error": "stale_ref",
  "message": "The element reference is no longer valid for the current page. Call browser_snapshot again."
}
```

---

## Storage

Rules store should be workspace-specific.

Recommended file:

```txt
.pi/browser/rules.json
```

Schema:

```json
{
  "version": 1,
  "rules": []
}
```

Do not store raw cookies, tokens, localStorage, screenshots or sensitive page data in rules.

Ref map is runtime-only and should not be persisted long-term.

---

## Security and safety

1. `browser_evaluate` must not be exposed to agent.
2. Internal evaluate scripts must be fixed collectors, not arbitrary agent-provided JS.
3. Agent actions must be limited to refs/selectors visible in last filtered snapshot.
4. URL changes invalidate refs.
5. Rules decide visibility, but not authentication or cookie handling.
6. Cookie import and browser lifecycle admin endpoints should not be available as agent-facing tools.
7. Do not leak hidden DOM, localStorage, cookies, tokens, or full raw snapshot outside selected Rules.

---

## Implementation order

### Phase 1: Core provider and tools

1. Implement CamofoxClient.
2. Implement CamofoxProvider for navigate, snapshot, click, type, press, scroll.
3. Implement `browser_navigate`.
4. Implement raw `browser_snapshot` passthrough behind a debug flag only.
5. Implement `browser_click`, `browser_type`, `browser_press`, `browser_scroll` with basic ref mapping.

### Phase 2: Rules and filtered snapshot

1. Implement RulesStore.
2. Implement PageMatcher.
3. Implement SubtreeRule materialization.
4. Implement camofox-like YAML renderer.
5. Make `browser_snapshot` return only enabled matching Rules.
6. Add ref validation for actions.

### Phase 3: Candidates and TUI

1. Implement candidate collector.
2. Implement candidate grouping by page key.
3. Implement Candidates tab.
4. Implement Rules tab.
5. Implement fuzzy filter via `/`.
6. Implement `e`, `d`, `space`, `a`, `p` key bindings.

### Phase 4: Boundary picker

1. Implement Subtree boundary picker: self, parent, parent+1, parent+2, custom.
2. Implement preview for selected boundary.
3. Implement rule creation from selected boundary.
4. Implement selector quality labels: stable / ok / fragile.

### Phase 5: Range rules

1. Add candidates for heading, paragraph, list, text blocks and buttons.
2. Implement Range boundary picker.
3. Implement document-order node extraction.
4. Implement RangeRule materialization.
5. Test long vacancy/article/documentation pages.

### Phase 6: Hardening

1. Add stale ref validation.
2. Add continuation support for very large selected areas.
3. Add tests for same selector on different page scopes.
4. Add tests for repeated candidates.
5. Add tests for disabled/all rules.
6. Add tests for empty snapshot.

---

## Acceptance criteria

### Agent API

* Agent sees only six tools.
* Agent can navigate, snapshot, click, type, press, scroll.
* Agent never sees Rules or Candidates.
* Agent never passes `rules`, `scope`, `selector budgets`, `maxChars`, `maxItems` to snapshot.

### Snapshot

* Output is camofox-like YAML string.
* Output is filtered by enabled Rules matching current page.
* Empty Rules produce empty snapshot.
* Same selector on different pages does not conflict.
* Snapshot refs are actionable only if visible.

### TUI

* TUI has Rules and Candidates tabs.
* Candidates are grouped.
* Candidates are grouped by page key.
* `/` fuzzy filters candidates/rules.
* `e` enables/disables all rules.
* `d` deletes selected rule.
* User can manually add a rule.
* Candidate selection opens boundary picker, not direct add.
* Boundary picker supports subtree self/parent/parent+n/custom.
* Boundary picker supports range start/end.

### HH examples

Main page listing:

* User selects `Откликнуться` candidate.
* User picks parent+n area.
* Rule applies only to `*.hh.ru /` or relevant search page.
* Snapshot shows each visible listing area with vacancy link and corresponding apply button.

Vacancy page:

* User selects heading or another boundary candidate.
* User creates range from h1 to `button "Пожаловаться на вакансию"`, excluding end.
* Snapshot includes title, salary, description paragraphs, lists, skills, location and apply buttons.
* Snapshot excludes complaint button and reviews.

### Action validation

* Clicking a ref from current snapshot works.
* Clicking a ref not in current snapshot fails.
* Clicking a ref after navigation fails with stale ref.
* Typing into synthetic ref works if it maps to allowed selector.

---

## Final desired behavior examples

### Example 1: no matching rules

Agent calls:

```json
{ "tabId": "tab_1" }
```

Tool returns:

```json
{
  "url": "https://hh.ru/",
  "snapshot": "",
  "refsCount": 0,
  "truncated": false,
  "hasMore": false
}
```

### Example 2: main page selected area around repeated apply buttons

Tool returns:

```json
{
  "url": "https://hh.ru/",
  "snapshot": "- group [p1]:\n  - link \"Junior Devops Engineer\" [e56]:\n    - /url: /vacancy/132616454\n  - text: до 100 000 ₽ за месяц, на руки\n  - link \"evrone.ru\" [e57]\n  - button \"Откликнуться\" [e59]\n\n- group [p2]:\n  - link \"DevOps-инженер\" [e39]:\n    - /url: /vacancy/132995841\n  - text: Опыт 1-3 года Можно удалённо\n  - link \"ПАО Ростелеком\" [e40]\n  - button \"Откликнуться\" [e43]",
  "refsCount": 6,
  "truncated": false,
  "hasMore": false
}
```

### Example 3: vacancy page range

Tool returns:

```json
{
  "url": "https://spb.hh.ru/vacancy/132616454",
  "snapshot": "- heading \"Junior Devops Engineer\" [level=1]\n- text: до 100 000 ₽ за месяц, на руки\n- paragraph: \"Опыт работы: 1–3 года\"\n- button \"Откликнуться\" [e16]\n- paragraph:\n  - strong: Привет!\n  - text: Команда\n  - strong: Evrone\n  - text: занимается продуктовой разработкой...\n- heading \"Ключевые навыки\" [level=2]\n- list:\n  - listitem: DevOps\n  - listitem: Kubernetes\n  - listitem: Git\n- heading \"Где предстоит работать\" [level=2]\n- text: Запросить точный адрес Москва Вакансия опубликована 11 мая 2026 в Москве\n- button \"Откликнуться\" [e26]",
  "refsCount": 2,
  "truncated": false,
  "hasMore": false
}
```

---

## Non-goals for MVP

Do not implement yet:

```txt
schema-based extraction as agent-facing tool
full screenshot analysis
network inspection
CDP provider
Firecrawl provider
agent-browser provider
automatic domain-specific wrappers
automatic vacancy/product/issue entity detection
agent-managed rules
agent-managed candidates
```

The MVP must prove the core contract: user-selected visibility through TUI, camofox-like filtered snapshots for agent, and safe actions against visible refs only.
