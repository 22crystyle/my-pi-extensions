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
