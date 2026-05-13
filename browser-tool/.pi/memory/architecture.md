# Архитектура browser-tool

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
4. материализует `subtree` и `range` rules в `SnapshotNode[]`;
5. дедуплицирует nodes;
6. присваивает public refs и сохраняет runtime-only ref map;
7. рендерит camofox-like YAML;
8. возвращает continuation chunks для больших snapshots.

Если нет matching enabled rules, возвращается пустой snapshot без объяснения причин. Raw snapshot passthrough доступен только при `debugRawSnapshot` в UI state.

## Action validation

Action tools валидируют `ref`/`selector`/`text` по runtime-only ref map последнего filtered snapshot. URL change делает refs stale. `selector`/`text` разрешаются только если находятся внутри видимых областей или совпадают с entries последнего snapshot.

## Generated rule selectors

Generated subtree rules from Candidates are built from concrete Camofox DOM occurrences. Candidate occurrences may carry a `selectorIndex` for non-unique CSS selectors. Generated persistent rules must not use text pseudo-selectors (`:has-text`/`text=`) or positional `nth-of-type`/`nth-child` selectors. For parent boundaries, the Camofox provider derives safe reusable selectors from DOM attributes/classes or structural CSS `:has(...)` paths anchored to the selected candidate element; if no safe selector can be derived, rule creation/preview fails instead of persisting a brittle selector.
