# VNO-60 changelog

## 2026-11-04 VNO-60: VN Studio follows whichever model Strata runs (hub HUB-26, T1)

Branch `VNO-60_strata-model-discovery`, from `master`. Committed on that branch; not pushed, not merged.

Behaviour: `strata/default` and `strata/default-low` are `loaded` rows. The engine asks Strata which model it serves, applies the matching `profiles` entry to those rows in place, shows `Strata: <model>` in the Models page and follows a model switch within one status check (10 s). The old ids resolve through `aliases`.

### C1 rule -> file:line map (line numbers on this branch)

| C1 | what | where |
|---|---|---|
| C1.1 | model row `loaded`, `aliases`, `json_schema`; profile schema; provider `profiles` | `src/shared/schemas.ts:47-49` (row fields), `:55` (`providerProfileSchema`), `:105-106` (`profiles`) |
| C1.1 | seed block (rows, `discover: true`, profiles) | `seed/config/providers.md:104-130` (strata block), field-docs bullet after `json_schema`, `## Strata` section (:206) |
| C1.2 r1 | loaded id L from `/status` `model` | `src/engine/models/registry.ts:474-476` (`syncServerSlots`) |
| C1.2 r1 | L from `/models` (first entry without `alias_of`), `meta.n_ctx` | `registry.ts:509-513` (`noteServed`), `:399-410` (`discover`), `src/engine/models/openaiCompat.ts:240-258` (`aliasOf`, `nCtx`) |
| C1.2 r1 | L kept across reloads, memory only; no answer or empty list leaves it | `registry.ts:165-168` (`servedIds`, `servedCtx`), `:211-215` (read back in `load`), `:510` (no non-alias entry: no change) |
| C1.2 r2 | profile K: same id, else longest prefix | `registry.ts:95-102` (`profileFor`) |
| C1.2 r3 | family, context, json_schema, extra_body of each `loaded` row; unknown L keeps the row's own | `registry.ts:527-539` (`applyServed`), `:246-250` (rows built in `load`) |
| C1.2 r4 | `-low` is only another `loaded` row | seed rows in `providers.md`; no code |
| C1.2 r5 | `strata` alias finds the first `strata/...` fallback row | unchanged `aliasMap`; seed `settings.md:5`, `roles.md:17` |
| C1.2 r6 | legacy refs through `aliases` (not listed as models) | `registry.ts:250,254-255` (`aliasRefs`), `:550-552` (`getModel`), `:597-599` (`resolve`) |
| C1.2 r7 | discovery adds no models; `picked` of such a provider skipped; catalog lists none | `registry.ts:399-410`, `:265` (picked skipped), `:326-330` (`catalog`) |
| C1.2 r8 | switch re-applies in place; `served` changes returned; log and event | `registry.ts:516-524` (`setServed`), `:457` (result `{ slots, served }`), `src/engine/engine.ts:221` (log `models: strata now serves <L> (was <old>)`), `:229-231` (servers event + snapshot) |
| C1.2 r9 | Strata down keeps L; UI text `not running (last: <L>)` | `registry.ts:516-524` (L never cleared), `src/renderer/ui/ModelsPage.tsx:24-28` (`servedNote`), `:471-473` |
| C1.2 r10 | `served` on model summaries, server status, provider summary, spend event | `src/shared/protocol.ts:50,88,122,465`, `src/engine/summary.ts:43,72,85`, `src/engine/queue/scheduler.ts:629`; labels `ModelsPage.tsx:31-36`, `:171`, `:255` |
| C1.2 r11 | per-model `json_schema` | `src/engine/models/router.ts:185`, `openaiCompat.ts:74`, `src/engine/models/types.ts:54` |
| C1.3 | neutral refs in defaults and seed | `src/shared/schemas.ts:160,167`, `seed/config/settings.md:5`, `seed/config/roles.md:17` |
| C1.4 | migration | `src/engine/store/seedMigrations.ts:37-62` (constants, `renameStrataRefs`), `:160-190` (`strata-loaded-v1`), `:192-200` (roles, settings) |

### Files changed

`src/shared/schemas.ts`, `src/shared/protocol.ts`, `src/engine/models/{registry,router,openaiCompat,types}.ts`, `src/engine/{summary,engine}.ts`, `src/engine/queue/scheduler.ts` (spend event only), `src/engine/store/seedMigrations.ts`, `src/renderer/ui/ModelsPage.tsx`, `seed/config/{providers,roles,settings}.md`, `tests/{models,seed-migrations,custom-providers}.test.ts`, `ROADMAP.md`, this folder.

### Deviations from the plan

- The migration is three `SEED_MIGRATIONS` entries, because an entry edits one file: `strata-loaded-v1` (providers.md), `strata-loaded-roles-v1` (roles.md), `strata-loaded-settings-v1` (settings.md). The ref rename walks every string of the file and replaces the two exact old refs (so it also covers `last_resort_model` if a file has one). Scriptorium and Book Translator keep their own one-function style.
- `syncServerSlots` returns `{ slots, served }` (the plan's "served changes list next to the slot changes"). The existing test calls use `.slots`.
- Extra summary fields: `thinking` on `ModelSummary` (for the label `Strata: <L>, thinking low`), `followsServer` and `served` on `ProviderSummary`.
- `registry.catalog()` (Detect models) on a provider with `loaded` rows lists nothing and only refreshes L.
- The per-call spend table (`spend/*.md`, fixed columns) is not changed: it keeps the ref id (`default`). The UI `spend` event carries `served`. A new column would need a migration of the existing spend files.
- Existing tests adjusted for the new default refs and the new return shape: `models.test.ts`, `custom-providers.test.ts` (`strata/default` instead of `strata/qwen3.8-flash-next`), `seed-migrations.test.ts` (the lists of recorded migration ids).

### Verification

- `yarn typecheck`: no errors. `yarn lint`: no output. `yarn test` (vitest): 88 files, 1149 tests, all passed.
- AC-1: the extended test "a server that does not answer is down ... its loaded rows follow the model it runs" (`tests/models.test.ts`): DeepSeek served gives family deepseek and `reasoning_effort` none / low; discovery adds no `strata/<id>` model; legacy `strata/qwen3.8-flash-next-low` resolves; a switch to `qwen3.8-flash-next-iq3_s` changes the same objects to family qwen; down keeps L.
- AC-3: new case in `tests/seed-migrations.test.ts` (old rows replaced, own row kept, profiles added, refs renamed in roles and settings, runs once, a deleted strata provider untouched).
- AC-2: the existing seed-config tests, green.
- AC-5 (this repo): grep for `run-iq2_xs`, `coder-iq1_m`, `84 GB`, `Qwen3.8-Flash-Next server`, `server for Qwen3.8` over `seed/config`: no hit.

### Not run

- Nothing against a running Strata (hub live checks L3, L5); no app started; no user data touched (`~\VisualNovels` is migrated when VN Studio next starts).
- The Models page labels were typechecked, not looked at in the running app.

## Polish (checker findings)

- `resolve()` now also maps an alias whose fallback row still names an old ref of a `loaded` row (`strata/qwen3.8-flash-next`) to the row (`strata/default`), as Scriptorium does, so the shared-order list holds `strata/default` once. One assertion added to the existing AC-1 Strata test; it failed before the fix and passes after.
