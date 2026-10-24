# VNO-43: Fallback models as an open list

Ticket folder: `.claude/tickets/VNO-43-fallback-models-list/` (this plan, plus `changelog.md` written at the end).
Branch: `VNO-43_fallback-models-list`, cut from `origin/master`.

## Background & Goal

Migrate the open fallback list design from Scriptorium (SCP-19 / SCP-44) into Visual Novels Orchestrator.
Previously in VNO (VNO-39):
- `config/settings.md` used `group_defaults` (mapping group -> model) and `model_order` (an array of group names).
- The Models page showed fixed group rows (`paid`, `strata`, `lmstudio`, plus any custom provider).

Wanted (matching Scriptorium & user screenshot):
- An open list of fallback models of any length in `config/settings.md`:
  ```yaml
  fallbacks:
    - deepseek/deepseek-flash
    - strata/qwen3.8-flash-next
    - lmstudio/nail-qwen3.6-35b-a3b-mtp
  fallback_shared: false
  ```
- Each row stores only its model `provider/model`. Its **kind** is derived from the model's provider (`paid` for non-local API providers; provider id like `strata`, `lmstudio`, `client`, or custom provider id for local/custom providers).
- In the Models page UI:
  - Checkbox: "One fallback order for every role" (`order-shared`).
  - Fallback rows list (`fallback-row-<i>`):
    - Row index when shared (`1.`, `2.`, ...).
    - The alias it answers to in `roles.md`: `paid`, `paid-2`, `strata`, `lmstudio`, `lmstudio-2`, `client` (`fallback-alias-<i>`).
    - Kind dropdown (`fallback-kind-<i>`): API, each local provider, client providers. Changing kind selects the first ticked model of that kind.
    - Model dropdown (`fallback-model-<i>`): ticked models of that kind, plus current model.
    - Up (`fallback-up-<i>`), Down (`fallback-down-<i>`), and Remove (`fallback-remove-<i>`, disabled when only 1 row left).
  - "Add a fallback" button (`fallback-add`): appends a new fallback row with the first ticked API model (or first ticked model).
  - Dynamic explanatory text below based on whether shared order is on or off.
- Aliases:
  - A kind name (`paid`, `strata`, `lmstudio`, `client`, or custom provider id) resolves to the **first row of that kind**.
  - `<kind>-<n>` resolves to the n-th row of that kind.
  - An alias with no matching row is left unresolved and logged once on reload (`warnAliases`).
- Shared order logic:
  - When `fallback_shared: true`, roles try the rows top-to-bottom.
  - A role's own concrete model of a kind takes the place of the first row of that kind not taken yet.
  - A client model (e.g. `client/claude-code`, `client/antigravity`) listed by the role goes first.
  - Remaining entries and aliases follow in the role's own order, deduplicated.
- Migration & Compatibility:
  - Migrates older `group_defaults`, `default_*_model`, and `model_order` to `fallbacks` and `fallback_shared`.
  - When settings are saved, old keys are removed from `config/settings.md`.

## Implementation Checklist

- [x] **1. Schemas & Protocol (`src/shared/schemas.ts`, `src/shared/protocol.ts`)**
  - Add `fallbacks` and `fallback_shared` to `settingsSchema` with default values. Keep legacy keys as optional.
  - Support fallback derivation in schema parsing if `fallbacks` is omitted and legacy keys exist.
  - In `ModelSummary`, add `kind: string`.
  - In `SettingsSummary`, replace/augment with `fallbacks: string[]` and `fallbackShared: boolean`.
  - Update `ModelSettingKey` to `'fallbacks' | 'fallbackShared' | 'lmstudioParallel' | 'lmstudioContext' | 'lmstudioTtlMinutes'`.
- [x] **2. Model Registry (`src/engine/models/registry.ts`)**
  - Update `ModelDefaults` and `modelDefaultsOf` to store `fallbacks: string[]` and `shared: boolean`.
  - Implement `fallbackRefs()`, `kindOfRef(ref: string)`, `kindOf(ref: string)`.
  - Implement `aliasMap()`, `resolve(ref: string)`, and `unresolvedAliases()`.
  - Implement `roleEntries(role: string)` with shared-order logic (client models first, concrete models replacing matching kind rows, remaining entries following).
- [x] **3. Engine & Summary (`src/engine/engine.ts`, `src/engine/summary.ts`)**
  - In `summary.ts`, populate `kind: registry.kindOf(m.ref)` in `modelSummaries`.
  - In `engine.ts`:
    - Implement `warnAliases()` and call on start, settings load, and config watcher reloads.
    - Update `settingsSummary()` to return `fallbacks` and `fallbackShared`.
    - Update `saveSettings` command handler to accept `cmd.fallbacks` and `cmd.fallbackShared`, deduplicating and cleaning up old keys.
    - Update `removeCustomProvider` to filter removed provider from `fallbacks`.
    - Update `writeSettings` to delete old settings keys.
- [x] **4. Seed Migration (`src/engine/store/seedMigrations.ts` & `src/engine/store/seedRefresh.ts`)**
  - Add a seed migration `settings-fallbacks-v1` for `config/settings.md` to convert `group_defaults` and `model_order` into `fallbacks` and `fallback_shared`.
- [x] **5. UI (`src/renderer/ui/ModelsPage.tsx`, `src/renderer/ui/AgentsPage.tsx`)**
  - Update `ModelsPage.tsx`:
    - Add `rowKind`, `kindLabel`, and `kindsFor`.
    - Replace group rows with open fallback rows matching Scriptorium and user screenshot.
    - Wire up "One fallback order for every role" checkbox (`order-shared`).
    - Add row controls: kind select, model select, move up, move down, remove.
    - Add "Add a fallback" button (`fallback-add`).
    - Add contextual description text below the fallback list.
  - Update `AgentsPage.tsx`:
    - Check `fallbackShared` instead of `order.length > 0`.
- [x] **6. Seed Markdown Documentation (`seed/config/settings.md`, `seed/config/roles.md`)**
  - Update `seed/config/settings.md` frontmatter and "## Default models" body section.
  - Update `seed/config/roles.md` explanations of aliases.
- [x] **7. Tests & Verification**
  - Add tests for open fallbacks, aliases (`paid`, `paid-2`, `<kind>-<n>`), shared order, and client priority in `tests/models.test.ts`.
  - Update `tests/scheduler.test.ts` to test `fallbacks` and `fallback_shared`.
  - Update `tests/custom-providers.test.ts` for `fallbacks`.
  - Update `tests/seed-migrations.test.ts` for `settings-fallbacks-v1`.
  - Run `npm test`, `npm run typecheck`, and `npm run lint`.

## Verification Criteria
- All 985 tests pass across all 69 test files.
- TypeScript compiler passes without errors (`npm run typecheck`).
- Linter passes cleanly (`npm run lint`).
- UI controls match the required test IDs and behaviors from the screenshot and specification.
