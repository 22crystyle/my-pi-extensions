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

## 2026-05-13 — устранение text fallback и positional selectors при построении browser rules
Агент: AI Dev agent
Действие:
- Удалён fallback `:has-text(...)`/`text=` из DOM selector resolution в Camofox provider; `queryAllSmart` теперь использует только валидные CSS selectors через `document.querySelectorAll`.
- Убрана генерация `:has-text(...)` из reusable/unique selectors.
- Исправлен `resolveSelector`: для non-unique selectors теперь сохраняется исходный selector и индекс DOM-совпадения, чтобы materialize не повторял первый элемент и dedupe не схлопывал список до одного результата.
- Добавлен `selectorIndex` в candidate occurrences и передача occurrence index в parent-boundary derivation.
- Переработано построение generated subtree rules: self/parent/parent+1/parent+2 строятся из конкретного DOM occurrence camofox-browser, без persisted `nth-of-type`/`nth-child`; для parent boundaries используется безопасный структурный selector вида `tag:has(> ... candidate selector ...)`, либо стабильный reusable selector.
- Обновлено существующее правило `rule_mp458mbo_a2w5be5`: positional selector заменён на `span:has(> a[data-qa="serp-item__title"])`.
Файлы: `src/providers/camofox/camofoxProvider.ts`, `src/core/browserToolService.ts`, `src/core/types.ts`, `.pi/browser/rules.json`, `.pi/memory/actions.md`, `.pi/memory/decisions.md`, `.pi/memory/architecture.md`
Результат: Новые generated rules больше не сохраняют text fallback и brittle `div:nth-of-type...`; non-unique selectors materialize все DOM-совпадения вместо первого.
Как проверить: Перезапустить/перезагрузить extension, открыть `hh.ru`, выполнить `browser_snapshot` с включённым `rule_mp458mbo_a2w5be5` и убедиться, что возвращаются все заголовки `a[data-qa="serp-item__title"]` из безопасного parent selector.

## 2026-05-13 — перевод range snapshot на clipping accessibility tree
Агент: AI Dev agent
Действие:
- Заменена materialization `range` rules с плоского DOM-derived списка на tree clipping единого camofox-like snapshot tree.
- Добавлен provider contract `getSnapshotTree()`; Camofox provider получает полный raw snapshot по continuation chunks и парсит его в `SnapshotNode[]`.
- Добавлены preorder flatten/clip helpers для сохранения родительской вложенности при вырезании диапазона.
- Усилен parser camofox-like YAML для refs, heading levels, `/url`, quoted/scalar/container строк.
- Изменён renderer scalar roles (`paragraph`, `listitem`, `text`, `strong`, etc.) ближе к camofox-like YAML, чтобы clipped range не превращал элементы списка в synthetic quoted nodes.
- Добавлен `BoundaryLocator.match` и убран implicit selector/text OR в boundary matching.
- Generated range boundaries теперь не сохраняют DOM selector: start для `h1` использует structural match, end использует text match.
- Обновлено hh vacancy range rule `rule_mp3vcwuq_8nykyar` на structural `h1` start и text `h2` end.
- Обновлены `AGENTS.md`, `.pi/memory/architecture.md`, `.pi/memory/decisions.md`.
Файлы: `src/core/rulesEngine.ts`, `src/core/snapshotMaterializer.ts`, `src/core/selectorEngine.ts`, `src/core/types.ts`, `src/core/browserToolService.ts`, `src/providers/camofox/camofoxProvider.ts`, `src/providers/camofox/camofoxSnapshotParser.ts`, `src/providers/camofox/camofoxYamlRenderer.ts`, `src/tui-extension/browserPanel.ts`, `.pi/browser/rules.json`, `AGENTS.md`, `.pi/memory/actions.md`, `.pi/memory/architecture.md`, `.pi/memory/decisions.md`
Результат: `range` snapshots сохраняют исходную иерархию, не создают плоские непонятные `group` из DOM wrappers и больше не матчят stale text boundary только по generic selector.
Как проверить: Выполнить `/browser-snapshot hh-vacancy-costraint.yaml`, затем `yq -r ".snapshot" hh-vacancy-costraint.yaml > hh-vacancy-costraint-snap.yaml`; сравнить с участком полного `hh-vacancy-snap.yaml` от `h1` до `Задайте вопрос работодателю`: должна сохраниться вложенность списков/параграфов, не должно быть DOM-wrapper `group` строк.

## 2026-05-13 — добавление Nix dev shell
Агент: AI Dev agent
Действие:
- Создан `devshell.nix` для локального dev-окружения на NixOS/Nix.
- В dev shell добавлены Node.js, TypeScript compiler, `jq` и `yq`.
- Обновлена архитектурная память с указанием dev shell файла и команды запуска.
Файлы: `devshell.nix`, `.pi/memory/actions.md`, `.pi/memory/architecture.md`
Результат: Проект можно открыть в воспроизводимом Nix shell для локальной диагностики и TypeScript/Node-инструментов.
Как проверить: Выполнить `nix-shell devshell.nix`, затем `node --version`, `npm --version`, `tsc --version`, `jq --version`, `yq --version`.

## 2026-05-13 — замена classic devshell на flake
Агент: AI Dev agent
Действие:
- Создан `flake.nix` с `devShells.default` для flakes-enabled NixOS.
- Удалён `devshell.nix`, так как пользователь использует flakes.
- Обновлена архитектурная память с командой `nix develop`.
Файлы: `flake.nix`, `devshell.nix`, `.pi/memory/actions.md`, `.pi/memory/architecture.md`
Результат: Dev shell проекта теперь запускается через flakes.
Как проверить: Выполнить `nix develop`, затем `node --version`, `npm --version`, `tsc --version`, `jq --version`, `yq --version`.

## 2026-05-13 — исправление flake dev shell для nixpkgs без nodePackages
Агент: AI Dev agent
Действие:
- Исправлена ошибка `nodePackages has been removed` в `flake.nix`.
- `pkgs.nodePackages.typescript` заменён на top-level `pkgs.typescript`, совместимый с текущим `nixos-unstable`.
- Проверен `nix flake check --no-build`.
Файлы: `flake.nix`, `.pi/memory/actions.md`
Результат: `devShells.default` успешно вычисляется на текущем nixpkgs.
Как проверить: Выполнить `nix flake check --no-build`, затем `nix develop`.

## 2026-05-13 — добавление pi/tsx/node typings в flake dev shell
Агент: AI Dev agent
Действие:
- В `flake.nix` добавлены `pkgs.tsx` и `pkgs.pi-coding-agent`.
- Добавлен Nix-built synthetic node_modules tree с symlink на `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@types/node` и `tsx` из `pi-coding-agent` package closure.
- Shell hook теперь экспортирует `BROWSER_TOOL_NIX_NODE_MODULES`, `NODE_PATH` и создаёт/обновляет локальный symlink `node_modules` на Nix-built tree.
- В `.gitignore` добавлен `node_modules`, чтобы generated symlink не попадал в git.
- Проверены `nix flake check --no-build`, `nix develop` и resolution pi packages через generated `node_modules`.
Файлы: `flake.nix`, `.gitignore`, `.pi/memory/actions.md`, `.pi/memory/architecture.md`
Результат: `nix develop` предоставляет `tsx`, `@types/node`, `@mariozechner/pi-coding-agent` и `@mariozechner/pi-tui` без npm install.
Как проверить: Выполнить `nix develop --command bash -lc 'tsx --version && test -e node_modules/@mariozechner/pi-coding-agent/package.json && test -e node_modules/@mariozechner/pi-tui/package.json && test -e node_modules/@types/node/package.json'`.

## 2026-05-13 — удаление compatibility/guard мусора после исправления rule selector generation
Агент: AI Dev agent
Действие:
- Пересмотрено действие от 2026-05-13 «устранение text fallback и positional selectors при построении browser rules».
- Удалены compatibility fields `fallbackSelectors` из rule/provider типов и materialization path.
- Удалены generated-selector blacklist guards из core/provider; manual/custom selectors больше не ограничиваются этими проверками.
- Удалены `createdFrom`/`candidateSelector` metadata из rule schema и текущего `.pi/browser/rules.json`.
- Удалены disabled старые rules из `.pi/browser/rules.json`.
- Убрана генерация positional `nth-of-type` selector в Camofox `uniqueSelector` и удалены остаточные `nth-*` normalization/quality branches.
- Удалены неиспользуемые stub/parser файлы, кроме `camofoxSnapshotParser.ts`, который сохранён для snapshot-tree range materialization.
Файлы: `src/core/browserToolService.ts`, `src/core/rulesEngine.ts`, `src/core/types.ts`, `src/core/selectorEngine.ts`, `src/providers/camofox/camofoxProvider.ts`, `src/tui-extension/candidatesTab.ts`, `src/tui-extension/rangePicker.ts`, `src/tui-extension/rulesTab.ts`, `.pi/browser/rules.json`, `.pi/memory/actions.md`, `.pi/memory/decisions.md`, `.pi/memory/architecture.md`
Результат: В проекте не осталось обратной совместимости для старых selector fallbacks/rule metadata и лишних guard rules; persisted rules очищены от legacy metadata.
Как проверить: `rg "fallbackSelectors|createdFrom|candidateSelector|has-text|text=|nth-of-type|nth-child|fragile|positionalSelector|isGeneratedRuleSelectorAllowed|isRuleSafeSelector" src .pi/browser/rules.json` не должен находить проектный код/правила, кроме допустимых упоминаний в memory/docs.

## 2026-05-14 — группировка Candidates по будущему rule selector
Агент: AI Dev agent
Действие:
- Добавлена горячая клавиша `g` во вкладке `/browser` → Candidates для переключения grouped-view.
- В grouped-view кандидаты объединяются по тому же rule selector, который используется как базовое generated subtree rule (`candidate.selector`), без сортировки и с сохранением порядка первого появления.
- В строках Candidates правило/selector вынесены перед текстом.
- Текст кандидатов обрезается до фиксированной длины; grouped-view отображает формат `Count: <n>, Rule: <selector>, Text: <truncatedText>`.
Файлы: `src/tui-extension/browserPanel.ts`, `.pi/memory/actions.md`
Результат: Во вкладке Candidates можно быстро увидеть, какие элементы создадут одинаковое правило, и избежать выбора слишком широких/одинаковых selectors; порядок элементов остаётся backend/DOM order.
Как проверить: Открыть `/browser` → Candidates, нажать `g`; проверить строки вида `Count: ..., Rule: ..., Text: ...`, повторно нажать `g` для обычного вида `Rule: ..., Text: ...`.

## 2026-05-14 — сохранение порядка и вложенности camofox snapshot для subtree rules
Агент: AI Dev agent
Действие:
- Переведён `browser_snapshot` с последовательной склейки materialized results каждого rule на единый `RulesEngine.materializeRules()`.
- `subtree` и `range` rules теперь применяются как preorder visibility intervals поверх одного `BrowserProvider.getSnapshotTree()`.
- Для `subtree` rules DOM selector resolution используется только для поиска anchor elements; anchors сопоставляются с узлами camofox snapshot по role/name/text/url и document order.
- Добавлена projection исходного snapshot tree с union пересекающихся rules, сохранением исходной вложенности и дедупликацией.
- `CamofoxProvider.resolveSelector()` теперь возвращает `name` и absolute `url` для более точного сопоставления DOM anchors с accessibility snapshot nodes.
- Обновлены архитектурная память и решение по обработке пересекающихся page rules.
Файлы: `src/core/browserToolService.ts`, `src/core/rulesEngine.ts`, `src/core/snapshotMaterializer.ts`, `src/core/types.ts`, `src/providers/camofox/camofoxProvider.ts`, `.pi/memory/actions.md`, `.pi/memory/architecture.md`, `.pi/memory/decisions.md`
Результат: Для hh vacancy list карточки и вложенные title links рендерятся в порядке/иерархии исходного camofox snapshot, а не блоками по порядку правил.
Как проверить: Выполнить `browser_snapshot` на `https://spb.hh.ru/vacancies` с rules `div[data-qa="vacancy-serp__vacancy"]` и `a[data-qa="serp-item__title"]`; проверить, что `link` находится внутри соответствующего `button` vacancy card. Дополнительно: `nix develop -c tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck index.ts` сейчас доходит до существующей unrelated ошибки `src/providers/camofox/camofoxClient.ts:57`.

### 15-05-2026: Рефакторинг архитектуры Browser Tool
- Удален парсинг AST и генерация YAML на стороне Node.js.
- Добавлен механизм In-Browser DOM Pruning через `camofoxProvider.pruneDomForSnapshot`.
- Убран слой RefMap: инструменты теперь используют нативные ID (eXX) camofox напрямую.
- Обновлены `browserToolService.ts` и `camofoxProvider.ts`.

### Исправление ошибок правил Subtree и Range (15-05-2026)
- Исправлена логика `findLocator` для Range-правил: добавлена поддержка `role`, `headingLevel` и других свойств.
- Исправлена проблема, при которой Subtree-правила захватывали текстовые узлы (raw text nodes) предков перед целевым элементом. Внедрено разделение на классы `.pi-pruned` (display: none) для лишних узлов, `.pi-ancestor` (visibility: hidden) для предков (чтобы скрыть их текстовые ноды) и `.pi-keep` (visibility: visible) для целевых узлов.
- Добавлена строгая проверка ошибок выполнения скриптов через `internalEvaluate`.

### Исправление проблем с CSP и Range (15-05-2026)
- Исправлена проблема с Content Security Policy (hh.ru блокировал инъекцию тега <style> через `style-src`). Фильтрация DOM переведена на использование inline-стилей (`element.style.setProperty`), что обходит ограничения CSP.
- Исправлена ошибка поиска диапазонов: теперь поиск целевых элементов выполняется **до** скрытия DOM (чтобы функции проверки видимости текста работали корректно).

## 2026-05-16 — исправление кликов по ref из отфильтрованного снэпшота
Агент: AI Dev agent
Действие:
- Диагностирована проблема: после `snapshot()` с In-Browser DOM Pruning, рефы `[eXX]` из снэпшота соответствуют фильтрованному DOM. После `restoreDom()` camofox резолвит эти рефы против полного accessibility tree, что приводит к клику по неверному элементу.
- Исправлены `click()`, `type()`, `scroll()` в `BrowserToolService`: при использовании `ref` загружаются matching rules из `rulesStore` и временно применяется `pruneDomForSnapshot()` перед отправкой действия. restoreDom выполняется в `finally` для гарантии восстановления DOM.
Файлы: `src/core/browserToolService.ts`, `.pi/memory/actions.md`, `.pi/memory/decisions.md`
Результат: Клики/тайп/скролл по ref из снэпшота корректно резолвятся — DOM находится в том же фильтрованном состоянии, что и при снэпшоте.
Как проверить: Вызвать `browser_snapshot` на странице с включенным правилом, затем `browser_click(ref: "e3")` на элемент из снэпшота — клик должен произойти по правильному элементу.

## 2026-05-17 — исправление поломки динамических меню при In-Browser DOM Pruning
Агент: AI Dev agent
Действие:
- Выявлена причина неработающих dropdown/списков (например, выбор резюме на hh.ru) при выполнении `browser_click`: In-Browser DOM Pruning использовал `display: none !important`, что ломало вычисления позиционирования (например, Popper.js/Floating UI) и скрывало родительские контейнеры меню во время повторного pruning перед кликом.
- В `src/providers/camofox/camofoxProvider.ts` заменён `display: none !important` на `visibility: hidden !important` в методах `pruneDomForSnapshot` и `restoreDom`.
- Обновлены `.pi/memory/actions.md` и `.pi/memory/decisions.md`.
Файлы: `src/providers/camofox/camofoxProvider.ts`, `.pi/memory/actions.md`, `.pi/memory/decisions.md`
Результат: Элементы корректно удаляются из accessibility tree (сохраняя нативные индексы camofox), но их layout space (габариты) сохраняется, благодаря чему клики не ломают скрипты позиционирования динамических выпадающих меню.
Как проверить: Вызвать `browser_click` по кнопке открытия меню выбора резюме на `hh.ru` — выпадающий список должен успешно открыться без визуальных/скриптовых поломок.

## 2026-05-19 — многострочное отображение Candidates
Агент: AI Dev agent
Действие:
- Изменено отображение строк Candidates в `/browser`: `Count`, `Rule` и `Text` теперь выводятся на отдельных уровнях/строках.
- Сохранены курсор выбора `>` и иконка `[+]` на первой строке candidate item; переходы стрелками/PageUp/PageDown по-прежнему работают по candidate item, а не по внутренним строкам.
- Для вкладки Candidates уменьшено окно прокрутки до 5 items, чтобы многострочные записи не раздували панель за пределы экрана; длинные rule/text строки обрезаются по ширине.
Файлы: `src/tui-extension/browserPanel.ts`, `.pi/memory/actions.md`
Результат: Candidates читаются как вложенный блок `Count; Rule; Text`, не ломая выбор и навигацию.
Как проверить: Открыть `/browser` → Candidates, нажать `g` при необходимости, проверить формат многострочных entries, стрелки/Enter и видимость `[+]`.

## 2026-05-19 — диагностика таймаута browser-snapshot на hh search
Агент: AI Dev agent
Действие:
- Измерен путь `/browser-snapshot hh.yaml` для `https://spb.hh.ru/search/vacancy`: matching rule один — `div[data-qa="vacancy-serp__vacancy"]`.
- Проверено, что текущий CSS-pruning (`visibility: hidden`) занимает около 2 секунд, оставляет DOM из 6464 элементов на месте и после фильтра всё равно приводит `GET /snapshot` к 30-секундному timeout/500.
- Проверено, что даже при видимой только 1 карточке (`~127` visible elements) или при `body { display: none }` camofox snapshot на этой hh-странице занимает ~28–30 секунд; при временной замене `body` на DOM из 2 элементов snapshot занимает ~0.7 секунды.
Файлы: `.pi/memory/actions.md`
Результат: Причина таймаута — CSS-only hiding не уменьшает стоимость camofox snapshot на hh.ru, потому что тяжёлый DOM остаётся в документе; фильтрация добавляет overhead поверх почти полного времени raw snapshot.
Как проверить: Повторить профиль: `pruneDomForSnapshot` → `getRawSnapshot`; затем сравнить с временной заменой `document.body` на минимальный DOM.
