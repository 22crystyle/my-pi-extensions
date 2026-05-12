# Архитектурные решения

- Agent-facing API не генерируется из `openapi.json`; Camofox реализован как provider adapter.
- Агенту доступны только шесть browser tools: navigate, snapshot, click, type, press, scroll.
- `browser_evaluate` не является agent-facing tool; JS evaluation используется только внутри CamofoxProvider фиксированными collector/materializer scripts.
- Rules и Candidates не раскрываются агенту. Агент получает только filtered camofox-like YAML snapshot.
- Rules всегда содержат `PageMatcher`; одинаковые selectors на разных страницах не смешиваются.
- Rules storage workspace-specific: `.pi/browser/rules.json`.
- UI state storage workspace-specific: `.pi/browser/ui-state.json`.
- Ref map хранится только в памяти и инвалидируется фактом URL mismatch при action validation.
- Empty matching rules => empty snapshot без объяснения agent-facing причин.
- Large snapshots возвращаются через technical continuation chunks; смысловые `maxChars/maxItems` не добавляются в API агента.
- TUI `/browser` реализует Rules/Candidates tabs, fuzzy filter, rule toggles/delete/manual add/preview, candidate boundary picker и page-scope выбор.
