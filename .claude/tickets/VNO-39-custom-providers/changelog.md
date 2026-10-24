# VNO-39 changelog

## 2026-10-24: custom OpenAI-compatible providers, open groups, seeded ACP proxy, named MCP clients

Branch `VNO-39_custom-providers` (from origin/master). **Uncommitted.** 19 files changed, plus 2 new files.

### What changed
- **Custom providers.** The new file `src/engine/models/customProviders.ts` handles the slug, the key name, the URL check and the `parseDocument` round trip of `custom: true` entries.
- **New commands.** `src/engine/engine.ts`:
  - `saveCustomProvider`, `removeCustomProvider` and `testCustomProvider`. Removing a provider deletes its key and cleans `models.md` and the settings groups.
  - `addModel` takes `vision`.
  - `keyNames` is in the snapshot.
- **Settings groups.** `writeSettings` folds the old `default_*_model` fields into `group_defaults`.
- **Registry.** In `src/engine/models/registry.ts`, `ProviderInfo` gets `name` and `custom`. There is a new `hasKey`.
  - `groupOf` returns `paid` for non-local seed providers and the provider id for local or custom ones.
  - `resolve` accepts a provider id. When no group default is set, it falls back to the provider's first ticked model.
- **Schemas and protocol.**
  - `src/shared/schemas.ts`: `group_defaults` with the old fields still readable, and an open `model_order`.
  - `src/shared/protocol.ts`: `ModelGroup` is now a string. The new commands are in `COMMAND_TYPE_SET`, with the events `provider.tested` and `provider.saved`.
  - `summary.ts` carries the new fields.
- **UI.**
  - `src/renderer/ui/ModelsPage.tsx`: group rows come from the open groups. There is an Add provider form, Edit and Remove for custom providers, and a vision tick on add-by-id.
  - `SettingsPage.tsx`: the key select uses the key names the engine reports. `store.ts` was updated to match.
- **Named clients.** In `src/engine/models/client.ts`, tasks record `client` (no client named means `claude-code`). `vno_get_task` takes `client`.
- **Seed and migration.**
  - `seed/config/providers.md`: `acp` (off, local, port 7461) and the client model `antigravity` (vision), with docs.
  - `seed/config/settings.md` uses `group_defaults`. `roles.md` has text changes only.
  - `src/engine/store/seedMigrations.ts` has two new migrations, `providers-acp-v1` and `providers-client-antigravity-v1`.
- **Docs.** `README.md` has a Providers section. `docs/mcp-guide.md` covers named clients and Antigravity CLI as a client. `ROADMAP.md` has a VNO-39 row.

### Deviations
- API, Strata and LM Studio always have a group row. Every other local provider (Ollama, `acp`) is now its own group.
- `resolve(<provider id>)` falling back to the first ticked model is new. Without it, `acp-home` could not resolve before a default is set.
- A paid custom provider always gets an `api_key_env`.
- VN has no design doc, so the decision is recorded in the README and the ROADMAP.

### Verification
- `yarn test`: 944 tests in 69 files pass. New: `tests/custom-providers.test.ts`, cases in `tests/seed-migrations.test.ts` and `tests/mcp-http.test.ts`.
- The key tests use the real Windows credential store under a random name and delete it afterwards.
- `yarn typecheck` and `yarn lint` are clean.
- **Not run:** the UI in a running app (VN has no Playwright or demo backend), and the live check with LM Studio, the ACP proxy and Antigravity.

### Notes
- The branch is cut from master, without the unmerged `VNO-20-23_fixes`. Expect small merge conflicts.
