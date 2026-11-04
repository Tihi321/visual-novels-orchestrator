# VNO-60 Strata model discovery (VN Studio)

Branch: `VNO-60_strata-model-discovery` (from `master`). Ticket of the hub task HUB-26, task T1 (reference implementation for the Edu Studio, Scriptorium and Book Translator replays).

The plan is `C:\projects\Personal\creative-hub\.claude\tickets\HUB-26-strata-model-discovery\plan.md`. Read these parts of it:

- "C1. The shared contract" (C1.1 providers.md shape and schema fields, C1.2 resolution rules 1-11, C1.3 neutral refs, C1.4 migration contract).
- Table "Files and modules per repo", row `visual-novels-orchestrator`.
- "T1 (reference A)" and "T7", the paragraph "Seed doc text for T1-T6".
- Acceptance criteria AC-1 to AC-4 (AC-5 over this repo's `seed/config`).

## T1 checklist

- [x] C1.1 schema fields: `loaded`, `aliases`, model `json_schema`, provider `profiles` (`src/shared/schemas.ts`)
- [x] C1.2 rules 1-11 in `registry.ts`, `router.ts`, `openaiCompat.ts`, `summary.ts`, `engine.ts`, `ModelsPage.tsx`
- [x] C1.3 neutral refs in seed `roles.md`, `settings.md` and the code defaults
- [x] C1.4 migration: `strata-loaded-v1` (providers.md), plus `strata-loaded-roles-v1` and `strata-loaded-settings-v1` (one file per entry in `SEED_MIGRATIONS`)
- [x] Seed docs (T7 text) in `seed/config/providers.md`
- [x] Tests: AC-1 (`tests/models.test.ts`, the down/up test), AC-3 (`tests/seed-migrations.test.ts`, one case)
- [x] `ROADMAP.md` row
- [x] `yarn typecheck`, `yarn lint`, `yarn test` green (AC-4)

Result and the C1 rule to file:line map: `changelog.md` in this folder.
