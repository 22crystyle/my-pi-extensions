# Архитектура browser-tool

## Dev shell

- `flake.nix` — Nix flakes dev shell для локальной разработки/диагностики. Добавляет Node.js, TypeScript compiler, `tsx`, `jq`, `yq` и `pi-coding-agent`; запускается через `nix develop`.
- При входе в dev shell создаётся ignored symlink `node_modules -> $BROWSER_TOOL_NIX_NODE_MODULES` на Nix-built node_modules tree с `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@types/node` и `tsx`, чтобы standalone TypeScript/Node tooling мог резолвить pi runtime packages без `npm install`.

## Entry point

- `index.ts` — pi extension entry point. Регистрирует ровно шесть agent-facing browser tools и команды TUI:
  - `browser_navigate`
  - `browser_snapshot`
  - `browser_click`
  - `browser_type`
  - `browser_press`
  - `browser_scroll`
  - `/browser`
  - `/browser-config`
  - `/browser-snapshot` — user-facing preview/export of the exact `browser_snapshot` tool result

## Слои

- `src/tools/` — тонкие pi tool wrappers с agent-facing контрактами.
- `src/core/browserToolService.ts` — фасад сценариев: навигация, snapshot, action validation, candidates/rules orchestration.
- `src/core/` — типы, page matcher, rules engine, candidate grouping, ref map, continuation store, ошибки, рендеринг/утилиты.
- `src/providers/camofox/` — provider adapter для `camofox-browser`; OpenAPI не экспонируется агенту напрямую.
- `src/storage/` — workspace-specific storage:
  - `.pi/browser/rules.json`
  - `.pi/browser/ui-state.json`
- `src/tui-extension/` — TUI panel для Rules/Candidates, boundary picker и выбор page scope; custom input/rendering обрабатывается напрямую через API `@mariozechner/pi-tui`.

## Snapshot flow

`browser_snapshot`:
1. получает текущую/указанную вкладку через provider;
2. строит `PageMatcher` текущей страницы;
3. загружает enabled rules из `.pi/browser/rules.json`;
4. получает единый camofox-like accessibility snapshot tree через `BrowserProvider.getSnapshotTree()`;
5. превращает все matching `subtree` и `range` rules страницы в preorder visibility intervals поверх этого source tree;
   - `subtree` materialization использует provider selector resolution только для поиска DOM anchors и затем fuzzy-сопоставляет их с узлами source snapshot tree по role/text/name/url в исходном порядке;
   - `range` materialization использует те же preorder индексы source tree для поиска boundaries;
   - пересекающиеся rules объединяются как union intervals; порядок YAML всегда определяется source tree, а не порядком rules;
6. строит projection source tree с сохранением исходной вложенности выбранных областей и без дублей;
7. дедуплицирует nodes;
8. присваивает public refs и сохраняет runtime-only ref map;
9. рендерит camofox-like YAML;
10. возвращает continuation chunks для больших snapshots.

Если нет matching enabled rules, возвращается пустой snapshot без объяснения причин. Raw snapshot passthrough доступен только при `debugRawSnapshot` в UI state.

## Action validation

Action tools валидируют `ref`/`selector`/`text` по runtime-only ref map последнего filtered snapshot. URL change делает refs stale. `selector`/`text` разрешаются только если находятся внутри видимых областей или совпадают с entries последнего snapshot.

## Generated rule selectors

Generated subtree rules from Candidates are built from concrete Camofox DOM occurrences. Candidate occurrences may carry a `selectorIndex` for non-unique CSS selectors. Generated persistent subtree rules must not use text pseudo-selectors (`:has-text`/`text=`) or positional `nth-of-type`/`nth-child` selectors. For parent boundaries, the Camofox provider derives safe reusable selectors from DOM attributes/classes or structural CSS `:has(...)` paths anchored to the selected candidate element; if no safe selector can be derived, rule creation/preview fails instead of persisting a brittle selector.

Generated range rules are snapshot-tree boundaries, not DOM selectors. Range start/end locators use explicit `BoundaryLocator.match` modes (`structure`, `text`, `selector`, `all`) and must not rely on implicit selector/text OR semantics. For hh vacancy pages, the vacancy content range starts at the first level-1 heading by structure and ends at the level-2 heading `Задайте вопрос работодателю` by text.

## Rule overlap handling

All enabled rules matching the current URL are applied together. Broad page rules such as `*.hh.ru *` and specific page rules such as `spb.hh.ru /vacancies` do not override each other; their selected areas are unioned over the same source snapshot tree. Page specificity is used only as metadata/tie-breaker for rule ownership annotations, not for YAML ordering. YAML ordering and nesting are always inherited from the camofox source snapshot tree.
