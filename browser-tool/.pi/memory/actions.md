# Журнал действий

## 2026-05-12

- Прочитан `AGENTS.md` и `PLAN.md`.
- Изучены pi docs по extensions/TUI и examples extensions.
- Создана структура extension проекта:
  - `index.ts`
  - `package.json`
  - `src/tools/`
  - `src/core/`
  - `src/providers/camofox/`
  - `src/storage/`
  - `src/tui-extension/`
  - `.pi/browser/`
- Реализован Camofox provider adapter (`CamofoxClient`, `CamofoxProvider`, mapper/parser/YAML renderer).
- Реализованы шесть agent-facing tools: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press`, `browser_scroll`.
- Реализованы RulesStore, UiStateStore, PageMatcher, RulesEngine, CandidatesEngine, RefMapStore, ContinuationStore.
- Реализована filtered snapshot materialization для subtree/range rules и camofox-like YAML output.
- Реализована runtime action validation по refs/selectors/text из последнего filtered snapshot.
- Реализована TUI команда `/browser` с Rules/Candidates tabs и boundary picker; добавлена `/browser-config` для camofox URL/user/session/debug настройки.
- Добавлены начальные `.pi/browser/rules.json` и `.pi/browser/ui-state.json`.
- Выполнена smoke-проверка загрузки всех TypeScript модулей через jiti; зарегистрированы ровно шесть browser tools.
- Добавлена команда `/browser-snapshot`, которая вызывает тот же `BrowserToolService.snapshot()` и показывает точный JSON tool-result, который получит агент; поддерживает вставку exact JSON/YAML в editor.
- Обновлена `/browser-snapshot`: `/browser-snapshot <fileName>` экспортирует exact JSON tool-result в файл относительно workspace; `--yaml` экспортирует только YAML snapshot, `--tab` задаёт вкладку.
