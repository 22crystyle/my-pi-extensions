# Журнал действий

## Формат
```
## <дата> — <короткое описание выполненной работы>
Агент:
Действие:
Файлы:
Результат:
Как проверить:
```
Существующие actions не должны изменяться.

## 2026-05-12 — подготовка проекта browser-tool
Агент: AI Dev agent
Действие:
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
Файлы: `AGENTS.md`, `PLAN.md`, `index.ts`, `package.json`, `src/tools/`, `src/core/`, `src/providers/camofox/`, `src/storage/`, `src/tui-extension/`, `.pi/browser/`
Результат: Подготовлена базовая структура pi extension для browser-tool.
Как проверить: Убедиться, что перечисленные файлы и директории существуют в `browser-tool/`.

## 2026-05-12 — реализация Camofox provider и browser tools
Агент: AI Dev agent
Действие:
- Реализован Camofox provider adapter (`CamofoxClient`, `CamofoxProvider`, mapper/parser/YAML renderer).
- Реализованы шесть agent-facing tools: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press`, `browser_scroll`.
- Реализованы RulesStore, UiStateStore, PageMatcher, RulesEngine, CandidatesEngine, RefMapStore, ContinuationStore.
- Реализована filtered snapshot materialization для subtree/range rules и camofox-like YAML output.
- Реализована runtime action validation по refs/selectors/text из последнего filtered snapshot.
Файлы: `index.ts`, `src/tools/`, `src/core/`, `src/providers/camofox/`, `src/storage/`
Результат: Browser-tool получил Camofox adapter, filtered snapshot pipeline и шесть agent-facing browser tools.
Как проверить: Запустить pi, попросить агента вызвать `browser_navigate`, затем `browser_snapshot`, и убедиться, что возвращается filtered camofox-like YAML snapshot.

## 2026-05-12 — реализация TUI панели browser-tool
Агент: AI Dev agent
Действие:
- Реализована TUI команда `/browser` с Rules/Candidates tabs и boundary picker.
- Добавлена `/browser-config` для настройки camofox URL/user/session/debug.
- Добавлены начальные `.pi/browser/rules.json` и `.pi/browser/ui-state.json`.
Файлы: `src/tui-extension/`, `.pi/browser/rules.json`, `.pi/browser/ui-state.json`
Результат: В TUI доступна настройка browser-tool, управление rules/candidates и начальное workspace-specific состояние.
Как проверить: Запустить pi в workspace, открыть `/browser` и `/browser-config`, проверить отображение tabs и сохранение состояния в `.pi/browser/`.


## 2026-05-12 — добавление команды browser-snapshot
Агент: AI Dev agent
Действие:
- Добавлена команда `/browser-snapshot`, которая вызывает тот же `BrowserToolService.snapshot()` и показывает точный JSON tool-result, который получит агент.
- Поддержана вставка exact JSON/YAML в editor.
- Обновлена `/browser-snapshot`: `/browser-snapshot <fileName>` экспортирует exact JSON tool-result в файл относительно workspace; `--yaml` экспортирует только YAML snapshot, `--tab` задаёт вкладку.
Файлы: `src/tui-extension/browserPanel.ts`, `src/core/browserToolService.ts`
Результат: Пользователь может просматривать, вставлять и экспортировать exact agent-facing `browser_snapshot` output из TUI.
Как проверить: Выполнить `/browser-snapshot`, `/browser-snapshot <fileName>`, `/browser-snapshot <fileName> --yaml` и убедиться, что вывод/экспорт совпадает с tool-result.

## 2026-05-12 — исправление обработки клавиш в TUI
Агент: AI Dev agent
Действие:
- Диагностирована причина неработающих стрелок/Esc в кастомных TUI вкладках: raw escape-sequence equality не покрывала Kitty keyboard protocol / tmux CSI-u последовательности, тогда как встроенный `ctx.ui.confirm()` использует matcher API pi-tui.
- Переработана обработка клавиш в `src/tui-extension/browserPanel.ts`: кастомные TUI-компоненты теперь напрямую используют экспортируемые API `@mariozechner/pi-tui` (`matchesKey`, `Key`, `Input`, `truncateToWidth`) без project-local keyboard wrappers и без прямых terminal decoder helpers в проектном коде.
- Удалён `src/core/keyboard.ts`, так как отдельная обёртка над terminal input больше не нужна.
Файлы: `src/tui-extension/browserPanel.ts`, `src/core/keyboard.ts`, `index.ts`
Результат: Кастомные TUI вкладки используют устойчивую обработку клавиш через `@mariozechner/pi-tui`.
Как проверить: Открыть `/browser` и проверить стрелки/Esc в кастомных tabs в обычном terminal/Kitty/tmux.

## 2026-05-13 — исправление скроллинга в TUI панели browser-tool
Агент: AI Dev agent
Действие:
- Диагностирована и исправлена ошибка, из-за которой список правил/кандидатов в TUI панели (`/browser`) уходил за границу экрана при перемещении курсора вниз.
- Добавлена логика "окна просмотра" (scroll view) в кастомный компонент внутри `src/tui-extension/browserPanel.ts`, сохраняющая текущую группировку по страницам (заголовки `Page: ...`).
- Реализован автоматический сдвиг окна и отрисовка только элементов, попадающих в заданный `pageSize` (20 элементов). Заголовки страниц теперь отображаются корректно и не дублируются.
Файлы: `src/tui-extension/browserPanel.ts`
Результат: При выборе элементов, находящихся ниже видимой области в `/browser`, список автоматически прокручивается.
Как проверить: Открыть `/browser`, дойти до конца видимого списка и убедиться, что список сдвигается вверх, не позволяя курсору уйти за экран.

## 2026-05-13 — исправление списка end-кандидатов в range picker
Агент: AI Dev agent
Действие:
- Прочитаны `.pi/memory/architecture.md`, `.pi/memory/decisions.md`, `.pi/memory/actions.md` и документация pi TUI (`docs/tui.md`).
- Убрано ограничение `samePage.slice(0, 20)` из выбора `End` в `range` mode boundary picker.
- Добавлен scroll-window для всех end-кандидатов страницы с индикаторами above/below и счётчиком позиции.
- Добавлены переходы `PgUp`/`PgDn`/`Home`/`End` для списков, обработка клавиш остаётся через `@mariozechner/pi-tui` (`matchesKey`, `Key`), ширина строк — через `truncateToWidth`.
- Проверено, что остальные TUI scroll-места в `browserPanel.ts` используют pi-tui key matching/width helpers, raw escape-sequence handling в проекте не найден.
- Зафиксировано архитектурное решение по TUI list scrolling/navigation в `.pi/memory/decisions.md`.
Файлы: `src/tui-extension/browserPanel.ts`, `.pi/memory/actions.md`, `.pi/memory/decisions.md`
Результат: В `range` picker можно добраться до всех доступных end-кандидатов страницы, а не только до первых 20.
Как проверить: Открыть `/browser` → Candidates → выбрать кандидат → range → End, пройти список стрелками или `PgDn` до элементов после первых 20; проверить, что отображаются индикаторы remaining candidates.

## 2026-05-13 — удаление сортировки Candidates
Агент: AI Dev agent
Действие:
- Убрана сортировка результата `CandidatesEngine.collect()` по странице и label.
- Убрана сортировка групп страниц при построении TUI списка Candidates.
- Range end picker оставлен без отдельной сортировки и теперь наследует исходный порядок `collectCandidates()`.
- Зафиксировано решение о сохранении backend/DOM порядка candidate-списков в `.pi/memory/decisions.md`.
Файлы: `src/core/candidatesEngine.ts`, `src/tui-extension/browserPanel.ts`, `.pi/memory/actions.md`, `.pi/memory/decisions.md`
Результат: Candidates и связанные списки выбора boundaries отображаются без явной сортировки.
Как проверить: Открыть `/browser` → Candidates и убедиться, что порядок соответствует порядку сбора provider/DOM; открыть range picker и проверить, что список End идёт в том же порядке.
