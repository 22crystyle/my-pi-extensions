# Архитектурные решения

## Формат

Дата:
Контекст:
Решение:
Причина:

Дата должна быть указана всегда, даже если сегодня уже были приняты какие-либо решения; существующие решения не должны изменяться.

---

Дата: 2026-05-12
Контекст: Требовалось определить способ интеграции `camofox-browser` и его `openapi.json` с agent-facing API browser-tool.
Решение: Agent-facing API не генерируется из `openapi.json`; Camofox реализован как provider adapter.
Причина: Agent-facing API должен оставаться стабильным и независимым от конкретного backend provider.

---

Дата: 2026-05-12
Контекст: Требовалось ограничить публичную поверхность browser automation tools для агента.
Решение: Агенту доступны только шесть browser tools: navigate, snapshot, click, type, press, scroll.
Причина: Минимальный набор инструментов покрывает основные сценарии browser automation и снижает риск небезопасных/избыточных действий.

---

Дата: 2026-05-12
Контекст: Для snapshot collection/materialization нужен JS evaluation внутри provider, но agent-facing arbitrary evaluation не должен быть доступен.
Решение: `browser_evaluate` не является agent-facing tool; JS evaluation используется только внутри CamofoxProvider фиксированными collector/materializer scripts.
Причина: Фиксированные scripts сохраняют контроль над поведением provider и не раскрывают агенту произвольное выполнение JavaScript.

---

Дата: 2026-05-12
Контекст: Rules и Candidates используются для внутренней настройки видимых областей snapshot.
Решение: Rules и Candidates не раскрываются агенту. Агент получает только filtered camofox-like YAML snapshot.
Причина: Агенту нужен только итоговый отфильтрованный снимок, а внутренние механизмы rules/candidates должны оставаться implementation detail.

---

Дата: 2026-05-12
Контекст: Visibility rules могут содержать одинаковые selectors на разных страницах.
Решение: Rules всегда содержат `PageMatcher`; одинаковые selectors на разных страницах не смешиваются.
Причина: Page-scoped rules предотвращают ошибочное применение selector rules к неподходящим URL/страницам.

---

Дата: 2026-05-12
Контекст: Требовалось определить место хранения visibility rules.
Решение: Rules storage workspace-specific: `.pi/browser/rules.json`.
Причина: Rules зависят от конкретного workspace и не должны протекать между проектами.

---

Дата: 2026-05-12
Контекст: Требовалось определить место хранения состояния TUI browser-tool.
Решение: UI state storage workspace-specific: `.pi/browser/ui-state.json`.
Причина: UI state зависит от конкретного workspace и должен быть изолирован от других проектов.

---

Дата: 2026-05-12
Контекст: Browser action validation использует refs из последнего filtered snapshot.
Решение: Ref map хранится только в памяти и инвалидируется фактом URL mismatch при action validation.
Причина: Refs должны быть временными и привязанными к текущей странице, чтобы stale refs не применялись после навигации.

---

Дата: 2026-05-12
Контекст: При отсутствии matching rules snapshot не содержит видимых для агента областей.
Решение: Empty matching rules => empty snapshot без объяснения agent-facing причин.
Причина: Agent-facing API должен возвращать только доступный filtered snapshot без раскрытия внутренних причин фильтрации.

---

Дата: 2026-05-12
Контекст: Большие snapshots могут превышать удобный размер ответа и требуют порционной выдачи.
Решение: Large snapshots возвращаются через technical continuation chunks; смысловые `maxChars/maxItems` не добавляются в API агента.
Причина: Continuation chunks решают техническое ограничение размера без добавления agent-facing параметров, меняющих смысл snapshot.

---

Дата: 2026-05-12
Контекст: Пользователю нужен TUI для настройки rules/candidates и preview filtered snapshot областей.
Решение: TUI `/browser` реализует Rules/Candidates tabs, fuzzy filter, rule toggles/delete/manual add/preview, candidate boundary picker и page-scope выбор.
Причина: TUI должен позволять управлять видимостью browser snapshot без раскрытия rules/candidates агенту.

---

Дата: 2026-05-12
Контекст: В кастомных TUI вкладках raw escape-sequence equality не покрывала Kitty keyboard protocol / tmux CSI-u последовательности.
Решение: Custom TUI keyboard handling must import and use `@mariozechner/pi-tui` directly (`matchesKey`/`Key`, built-in input components such as `Input`, `truncateToWidth`) instead of project-local keyboard wrappers, direct terminal decoder helpers, or raw escape-sequence equality.
Причина: Прямое использование `@mariozechner/pi-tui` обеспечивает совместимую обработку клавиш с built-in input components и избегает хрупких project-local wrappers/raw escape checks.

---

Дата: 2026-05-13
Контекст: В TUI browser-tool есть несколько scrollable списков: Rules/Candidates, range end picker и preview/export views. Требуется единообразное поведение скроллинга и совместимость с терминалами/Kitty/tmux.
Решение: TUI list scrolling/navigation must use `@mariozechner/pi-tui` APIs for keyboard matching and width-safe rendering (`matchesKey`, `Key`, `Input`, `truncateToWidth`). For simple ungrouped selection lists prefer built-in pi-tui components such as `SelectList`/`SettingsList`; custom scroll-window logic is allowed only where domain-specific grouping or mixed rows make built-ins unsuitable. Display windows must not truncate the underlying candidate data set (no `slice(0, N)` as a data limit).
Причина: Это сохраняет совместимость ввода с pi-tui, предотвращает повторение hard-coded ограничений списка и оставляет возможность кастомной отрисовки там, где стандартный список не покрывает UX.

---

Дата: 2026-05-13
Контекст: Пользователь хочет видеть Candidates и связанные candidate-списки (например, range end picker) в исходном порядке backend/DOM, без алфавитного переупорядочивания.
Решение: Candidates не сортируются ни в `CandidatesEngine.collect()`, ни при построении TUI списка Candidates. Range end picker использует порядок `collectCandidates()` и не добавляет свою сортировку.
Причина: Исходный порядок backend/DOM важнее алфавитной группировки для выбора boundaries на странице.

---

Дата: 2026-05-13
Контекст: Generated browser rules from Candidates could persist text-based pseudo selectors (`:has-text`) or positional `nth-of-type` chains when deriving parent boundaries, causing wrong matches and brittle hh.ru rules.
Решение: Generated rules must not use text-selector fallbacks (`:has-text`/`text=`) or positional `nth-of-type`/`nth-child` selectors. Camofox provider derives candidate self/parent rules from the concrete DOM occurrence, prefers reusable DOM attributes/classes and uses structural CSS `:has(...)` for exact parent boundaries; if a safe selector cannot be built, rule creation/preview fails instead of persisting a brittle selector.
Причина: Rules are persistent workspace configuration; they must be based on stable DOM structure returned by the browser provider, not on visible text or incidental DOM positions.

---

Дата: 2026-05-13
Контекст: `range` snapshot materialization built a separate flat DOM-derived node list, which produced synthetic `group` rows, lost indentation, and made constrained snapshots differ structurally from the full camofox accessibility snapshot.
Решение: `range` rules are materialized from a single provider snapshot tree (`BrowserProvider.getSnapshotTree`) by preorder boundary lookup and tree clipping. The old flat document-order DOM accessible list is not used for `range`.
Причина: `range` is a visibility projection over the same snapshot that the agent sees, so it must preserve the source accessibility hierarchy, refs and role/text rendering instead of reinterpreting the DOM.

---

Дата: 2026-05-13
Контекст: Boundary matching treated selector match as an unconditional success before checking role/text, so a stale vacancy title boundary could still match another vacancy only because `h1[data-qa="vacancy-title"]` matched.
Решение: Boundary locators use explicit `match` modes: `all`, `selector`, `text`, `structure`. Default matching requires all provided fields; selector/text are no longer an implicit OR. Generated range locators avoid DOM selectors and target snapshot-tree roles/text/structure.
Причина: Persistent range boundaries must be deterministic and must not silently ignore text constraints when a generic selector matches.
---

Дата: 2026-05-13
Контекст: Пересмотрено решение от 2026-05-13 «Generated browser rules from Candidates could persist text-based pseudo selectors (`:has-text`) or positional `nth-of-type` chains...» после требования убрать обратную совместимость и лишние защитные правила.
Решение: Generated rule pipeline не содержит отдельного blacklist/compatibility guard для `nth-*`, `:has-text` или `text=`. Вместо этого Camofox provider строит generated selectors только из DOM occurrence через reusable DOM attributes/classes и structural CSS `:has(...)`; manual/custom selectors остаются выбором пользователя и не блокируются project-level проверками.
Причина: Если проект сам не генерирует запрещённые формы selectors, отдельное правило-охранник является лишней логикой и мешает ручному выбору пользователя.

---

Дата: 2026-05-14
Контекст: Несколько subtree rules на одной странице (`div[data-qa="vacancy-serp__vacancy"]` и `a[data-qa="serp-item__title"]`) рендерились блоками по порядку правил, из-за чего title links отделялись от vacancy card hierarchy.
Решение: Snapshot materialization для всех matching rules страницы строит единый provider snapshot tree, превращает subtree/range rules в preorder visibility intervals и рендерит projection исходного дерева. DOM selector resolution для subtree используется только для поиска anchor nodes в source snapshot tree; отдельная DOM-materialization per rule больше не формирует agent-facing YAML.
Причина: Camofox raw snapshot уже содержит правильный accessibility order/nesting, а agent-facing filtered snapshot должен сохранять этот порядок и корректно объединять пересекающиеся page rules без дублей.

### Переход на In-Browser DOM Pruning (15-05-2026)
Вместо получения полного AST-дерева YAML от camofox и его фильтрации на стороне Node.js, расширение теперь использует **In-Browser DOM Pruning**. 
В момент снятия скриншота расширение применяет классы `pi-pruned` со стилем `visibility: hidden !important` ко всем нерелевантным узлам DOM в браузере (выполняя скрипт через `internalEvaluate`). Затем выполняется запрос нативного снапшота у camofox, который автоматически генерирует усеченный YAML с сохранением оригинальных индексов `[eXX]`. После этого стили скрытия откатываются.
Это решение позволило:
- полностью удалить слои AST-парсинга, YAML-рендеринга и сопоставления (`RefMap`);
- сохранить 100% точность индексов camofox;
- устранить проблемы неточного сопоставления (fuzzy match) элементов по тексту/ролям.

---

### Re-prune DOM перед действиями с ref (16-05-2026)
Контекст: In-Browser DOM Pruning выполняется только во время `snapshot()`. После `restoreDom()` рефы `[eXX]` из снэпшота указывают на элементы фильтрованного DOM, но при клике camofox резолвит их против полного accessibility tree — рефы не совпадают.
Решение: В `click()`, `type()` и `scroll()` при использовании `ref` загружаются текущие matching rules из `rulesStore` и временно повторно применяется фильтрация DOM (`pruneDomForSnapshot`) перед отправкой действия. После действия DOM восстанавливается (`restoreDom`). Это гарантирует, что accessibility tree в момент действия идентичен тому, что был при снэпшоте.
Причина: Refs из снэпшота корректно резолвятся только когда DOM находится в том же фильтрованном состоянии. Перечитывание правил из `rules.json` гарантирует консистентность с текущим состоянием правил.

---

Дата: 2026-05-17
Контекст: In-Browser DOM Pruning с использованием `display: none !important` ломает layout и вычисления позиционирования (например, Popper.js/Floating UI) при повторном pruning'е перед кликом, из-за чего динамические меню (напр., выбор резюме на hh.ru) не открываются, несмотря на успешное выполнение клика.
Решение: Использовать `visibility: hidden !important` вместо `display: none !important` для скрытия элементов.
Причина: `visibility: hidden` убирает элементы из accessibility tree (что необходимо для работы camofox индексов `[eXX]`), но сохраняет layout space, позволяя скриптам позиционирования и динамическим меню работать корректно во время клика.

---
Дата: 2026-05-19
Контекст: На hh.ru (`https://spb.hh.ru/search/vacancy`) клик по ссылке вакансии может открывать новую вкладку асинхронно относительно завершения provider `click`, из-за чего немедленная синхронизация вкладок не возвращала новый tab агенту.
Решение: После `browser_click` сервис сравнивает вкладки до/после действия и коротко ожидает появления нового tab или изменения URL текущего tab; если появился новый tab, он помечается активным в UI state и включается в agent-facing `tabs` результата клика.
Причина: Agent-facing результат действия должен отражать browser state после пользовательского эффекта клика, включая popup/new-tab сценарии, а не только мгновенный ответ backend click endpoint.

---
Дата: 2026-05-20
Контекст: Во вкладке `/browser` → Candidates обычный режим `[Candidates]` показывал уже объединённые значения с `Count > 1`, потому что `CandidatesEngine.collect()` безусловно дедуплицировал кандидатов до попадания в TUI. Это делало обычное состояние визуально похожим на `[Candidates grouped]` без нажатия `g`.
Решение: `CandidatesEngine.collect()` возвращает плоский список кандидатов в исходном backend/DOM order без dedup/grouping. Явная группировка candidates выполняется только в TUI grouped-view при включённом `candidateGroupByRule` (`g`).
Причина: Обычный режим Candidates должен показывать реальные DOM occurrences без скрытой агрегации; группировка должна быть явным пользовательским режимом.

---
Дата: 2026-05-20
Контекст: На hh.ru в диалоге выбора резюме несколько radio/input элементов имеют одинаковые reusable selectors и браузерное значение radio по умолчанию `on`, из-за чего Candidates были неинформативны, а generated subtree rules не попадали в выбранный occurrence.
Решение: Candidate labels для form controls извлекаются из доступных DOM label-источников (`aria-labelledby`, `label[for]`, closest label, surrounding text), а generated subtree rules могут хранить `selectorIndex` occurrence и применять pruning только к этому совпадению selector.
Причина: Persistent selector остаётся reusable и стабильным, но для выбора конкретного повторяющегося элемента нужен occurrence index; label должен отражать доступное имя элемента, а не техническое default value `on`.
