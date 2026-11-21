# Changelog VNO-67

## 2026-11-21 VNO-67: local models through the ACP proxy, Strata off

Repo visual-novels-orchestrator, branch `VNO-67_acp-for-all` (from origin/master). Uncommitted.

Files and behaviour:
- `seed/config/providers.md`: `acp` is on at `http://127.0.0.1:8787/v1`, concurrency 4, `discover_skip`, six local rows (C1); `strata` has `enabled: false` (rows and profiles kept); ACP and Strata prose rewritten (acp is the route to local models, Strata runs under the proxy, one local model on the GPU at a time). `lmstudio` unchanged.
- `seed/config/roles.md`: director and art-director `[paid, acp]`; script-analyst, composer, stage-director, voice-director `[acp, paid]`; edition-aligner `[acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs, paid]`; art-critic `[paid, lmstudio]`. Alias prose updated.
- `seed/config/settings.md`, `src/shared/schemas.ts`: fallbacks and `BUILTIN_FALLBACKS` use LOCAL (new exported `LOCAL_MODEL`); `BUILTIN_GROUP_DEFAULTS` gains `acp: LOCAL`.
- `src/engine/store/seedMigrations.ts`: migration `acp-port-8787-v1` (exact 7461 address of the `acp` row to 8787; adds no row, enables nothing), after `providers-acp-v1`.
- `src/engine/models/customProviders.ts`, `src/renderer/ui/ModelsPage.tsx`: example/default address 8787. `src/engine/cli.ts`: probe default refs `[LOCAL_MODEL, deepseek-flash]`.
- `README.md`, `docs/mcp-guide.md`, `ROADMAP.md`: docs and the VNO-67 row.
- Tests: `tests/seed-migrations.test.ts` (new table case 7461 rewritten / 9999 kept; seed acp assertions; migration id lists), `tests/models.test.ts` and `tests/custom-providers.test.ts` (seed assertions updated; every role resolves to LOCAL or DeepSeek, art-critic to DeepSeek + LM Studio; direct-Strata tests switch Strata on through a small helper).

Decisions (plan "read and confirm"):
- `BUILTIN_GROUP_DEFAULTS` is not a live alias source: aliases come from `fallbacks`. It is read by name only for legacy keys (`default_strata_model`, `group_defaults.strata` in `settingsSchema` and `groupDefaultsOf`), so the `strata` key is kept next to the new `acp` key.
- Other seed migrations read: none enables `strata` or reverts roles/fallbacks (`strata-loaded-roles-v1`/`-settings-v1` only rename old Strata refs; `settings-fallbacks-v1` only runs when `fallbacks` is missing). No guard needed.
- `scripts/prod-status.mjs`, `scripts/prod-watch.mjs`, `docs/protocol.md`, `repositories.md`: read; they do not show Strata or LM Studio as the chat servers, left unchanged.
- `tests/custom-providers.test.ts:54,61,67,107,113` keep 7461 as sample input for custom providers (not about the proxy's address); only the seed assertion (line ~289) changed.
- The `lmstudio` alias resolves to the first lmstudio fallback row (the text Gemma model); the art-critic's vision model is whatever the user ticks there, as before.

Verification (fnm default alias dir on PATH): `yarn vitest run` 89 files, 1155 tests passed; `yarn typecheck` exit 0; `yarn build:engine` exit 0.
Not run: live check (Models page / `vno` status listing the six acp ids, role defaults showing LOCAL), no proxy contacted; the user's `~\VisualNovels` not changed (hub HUB-38 L4).

Follow-ups: `studios/autostart.ts` GPU check for Gufo 8081 / Llama 8082; art-critic on a proxy vision model.

Polish 1: `src/engine/cli.ts` probe default refs are `[LOCAL_MODEL]` only (no paid call on a bare `probe`); `src/engine/index.ts` probe help text now says one short reply from the local model through the ACP proxy (or `--model`). Nothing else changed.
