# Changelog - VNO-43: Fallback models as an open list

**Date**: 2026-10-24
**Branch**: `VNO-43_fallback-models-list`
**Status**: Completed and fully verified

## Summary of Changes

Migrated the fallback models configuration from fixed group mappings (`group_defaults`, `model_order`) to an arbitrary-length open fallback models list (`fallbacks: string[]`, `fallback_shared: boolean`), matching the design from Scriptorium (SCP-19 / SCP-44) and the user UI screenshot.

### 1. Schema & Protocol
- **`src/shared/schemas.ts`**:
  - Added `fallbacks: z.array(z.string().min(1)).min(1).default(BUILTIN_FALLBACKS)` and `fallback_shared: z.boolean().default(false)` to `settingsSchema`.
  - Added schema preprocessor converting legacy `group_defaults`, `model_order`, and `default_*_model` keys into derived `fallbacks` and `fallback_shared`.
  - Exported `groupDefaultsOf(s)` for backward compatibility in existing helpers.
- **`src/shared/protocol.ts`**:
  - Added `kind: string` to `ModelSummary`.
  - Updated `SettingsSummary` with `fallbacks: string[]` and `fallbackShared: boolean`. Kept `groupDefaults` and `modelOrder` optional for compatibility.
  - Updated `ModelSettingKey` to include `'fallbacks' | 'fallbackShared'`.

### 2. Model Registry & Resolution
- **`src/engine/models/registry.ts`**:
  - Updated `ModelDefaults` and `modelDefaultsOf` to store `fallbacks: string[]` and `shared: boolean`.
  - Added `fallbackRefs(): string[]`, `kindOfRef(ref: string): string`, `kindOf(ref: string): string`.
  - Added `aliasMap(): Map<string, string>` and `unresolvedAliases(): string[]`.
    - First row of a kind is accessible by its kind alias (`paid`, `strata`, `lmstudio`, `client`, `<custom-provider>`).
    - N-th row of a kind is accessible by `<kind>-<n>` (`paid-2`, `lmstudio-2`, etc.).
    - Preserved `groupOf(ref)` behaviour returning `undefined` for `client` provider.
  - Updated `resolve(ref: string)` to resolve aliases via `aliasMap()`. If an alias has no matching fallback row, it remains unresolved as itself (so candidates router ignores it and `warnAliases` logs it).
  - Updated `roleEntries(role: string)`:
    - When `fallback_shared: true`, client models listed by the role go first.
    - Role's concrete models replace matching kind fallback rows in sequence.
    - Remaining role entries and aliases follow in order, deduplicated.

### 3. Engine & Auto-migration
- **`src/engine/summary.ts`**: Included `kind: registry.kindOf(m.ref)` in `modelSummaries`.
- **`src/engine/engine.ts`**:
  - Added `warnAliases()` logging any unresolved role aliases once on start and config reloads.
  - Updated `settingsSummary()` to return `fallbacks` and `fallbackShared`.
  - Updated `saveSettings` handler to accept `cmd.fallbacks` and `cmd.fallbackShared`, deduplicating entries and stripping legacy keys.
  - Updated `removeCustomProvider` to filter removed providers out of `fallbacks`.
  - Updated `writeSettings` to remove legacy keys (`group_defaults`, `model_order`, `default_*_model`) upon writing settings.
- **`src/engine/store/seedMigrations.ts`**:
  - Added `settings-fallbacks-v1` migration migrating legacy `group_defaults` and `model_order` to `fallbacks` and `fallback_shared`.

### 4. User Interface
- **`src/renderer/ui/ModelsPage.tsx`**:
  - Replaced the fixed group cards with an open fallback list matching Scriptorium and the user screenshot.
  - Added kind selector (`fallback-kind-<i>`) with options for API (`paid`), local providers (`strata`, `lmstudio`, etc.), and client providers (`client`).
  - Switching kind automatically selects the first ticked model of that kind.
  - Added model selector (`fallback-model-<i>`) listing ticked models of that kind (plus current model if unticked).
  - Added reorder controls (`fallback-up-<i>`, `fallback-down-<i>`) and row removal (`fallback-remove-<i>`, disabled when 1 row left).
  - Added "Add a fallback" button (`fallback-add`) appending a new row.
  - Added "One fallback order for every role" checkbox (`order-shared`).
  - Added dynamic explanatory guidance reflecting whether shared order is on or off.
- **`src/renderer/ui/AgentsPage.tsx`**:
  - Updated `RoleDefaults` to check `s.settings?.fallbackShared ?? false` instead of `order.length > 0`.

### 5. Documentation & Seed Files
- **`seed/config/settings.md`**: Updated frontmatter and description to use `fallbacks` and `fallback_shared`.
- **`seed/config/roles.md`**: Documented alias resolution rules (`paid`, `paid-2`, `<kind>-<n>`) and shared order behavior.

### 6. Tests & Verification
- **`tests/models.test.ts`**: Added comprehensive test coverage for open fallbacks, aliases (`paid`, `paid-2`), shared order placement, and client model precedence.
- **`tests/scheduler.test.ts`**: Updated test assertions for `fallbacks` and `fallback_shared`.
- **`tests/custom-providers.test.ts`**: Verified custom provider fallbacks and alias resolution.
- **`tests/seed-migrations.test.ts`**: Verified the `settings-fallbacks-v1` migration and updated seed hash expectation tests.

## Verification Commands & Output
1. `npm run typecheck`:
   - `tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json` exited with code 0 (0 errors).
2. `npm run lint`:
   - `eslint .` exited with code 0 (clean).
3. `npm test`:
   - 69 test files passed (100%).
   - 985 tests passed (100%).
