---
status: done
request: creative-hub/REQ-0030
repos: [visual-novels-orchestrator]
branch: VNO-67_acp-for-all
updated: 2026-11-21
---

# VNO-67 ACP for all: local models through the ACP proxy (port 8787); Strata switched off

Part of creative-hub HUB-38 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-38-acp-for-all\plan.md`). The user's decision: every app reaches every LLM, local ones included, through the ACP proxy (provider `acp`, `http://127.0.0.1:8787/v1`), which serves `gufo/*`, `strata/*`, `llama/*`. The `strata` provider stays in the code, switched off ("disable, keep code"). **The `art-critic` (vision) keeps its current provider** (LM Studio's vision model): LM Studio stays enabled and stays the target of the `lmstudio` alias, but no other role names it.

The seed ships acp disabled on the stale port 7461 (`seed/config/providers.md:144,198`, `README.md:110`) and there is no migration to 8787; the live config is on 7461 too, so acp does not work there today. Code and seed only here; the user's `~\VisualNovels` is changed by the hub (HUB-38 L4) after approval. VN project data holds old refs only in `log.md` / `pipeline.json` error text (checked): nothing to migrate there.

## Contracts (copied from HUB-38; keep identical)

LOCAL = `acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs`. The alias `acp` stands for the first `acp` row of `fallbacks`, which is LOCAL. Defaults never name `gufo/*` or `llama/*`.

C1, the `acp` provider (seed), cloud rows unchanged, local rows appended:

```yaml
  - id: acp
    name: ACP proxy
    kind: openai-compat
    enabled: true
    local: true
    base_url: http://127.0.0.1:8787/v1
    concurrency: 4
    json_schema: false
    discover: true
    discover_skip: [ qwen-image, nomic-embed ]
    models:
      # ... existing cloud rows unchanged ...
      # Local models through the proxy (HUB-38). One local model is loaded at a time across gufo, strata and llama;
      # a request for another one waits until the proxy has switched (minutes). LOCAL is the strata row.
      - id: strata/qwen3.8-flash-next-unsloth-ud-iq4_xs
        family: qwen
        context: 131072
        extra_body: { reasoning_effort: none }
      - id: gufo/Qwen3.8-27B
        family: qwen
        context: 32768
        extra_body: { reasoning_effort: none }
      - id: gufo/deepseek4
        family: deepseek
        context: 16384
        extra_body: { reasoning_effort: none }
      - id: gufo/flash-next-q4
        family: qwen
        context: 32768
        vision: true
        extra_body: { reasoning_effort: none }
      - id: llama/inkling-2-mini
        family: inkling
        context: 32768
        vision: true
      - id: llama/inkling-2-mini-dspark
        family: inkling
        context: 32768
        vision: true
```

C5: migration `acp-port-8787-v1` rewrites only the exact value `http://127.0.0.1:7461/v1` of the `acp` row's `base_url` to `http://127.0.0.1:8787/v1` (same rule as book-translator `src/engine/store/migrate.ts:328-348`).

## Scope

1. Seed `seed/config/providers.md`: acp = C1 (enabled, 8787); `strata` row `enabled: false` (rows, profiles kept); `lmstudio` unchanged. Prose line 198 and the Strata/LM Studio sections: acp is on and the route to local models; Strata runs under the proxy (it starts `D:\Strata\terminal\run-unsloth-ud-iq4_xs-parallel.bat` on request); the direct `strata` provider is a way back; LM Studio only for the art-critic's vision model; one local model on the GPU at a time.
2. Seed `seed/config/roles.md`: `director, art-director` `[paid, acp]`; `script-analyst, composer, stage-director, voice-director` `[acp, paid]`; `edition-aligner` `[acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs, paid]`; `art-critic` `[paid, lmstudio]` (vision; strata never had vision). Prose: aliases `paid`, `acp`, `lmstudio` (vision only).
3. Seed `seed/config/settings.md` `fallbacks` and `src/shared/schemas.ts:157-168`: `BUILTIN_FALLBACKS` = `['deepseek/deepseek-flash', LOCAL, 'lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic']`; `BUILTIN_GROUP_DEFAULTS`: the `strata` entry becomes `acp: LOCAL` (read how the map is used: it backs the aliases, and `acp` already works as an alias per the roles prose; if code looks up the key `strata` by name, keep a `strata` key too and say why), `paid` and `lmstudio` unchanged.
4. Seed migration `acp-port-8787-v1` (C5) in `src/engine/store/seedMigrations.ts`, next to `providers-acp-v1` (same `{id, file, apply(doc, seed)}` shape). It does not add rows or enable anything.
5. Port strings: `src/engine/models/customProviders.ts:48`, `src/renderer/ui/ModelsPage.tsx:84,308`, `README.md:110`, `docs/` mentions: 8787. `tests/custom-providers.test.ts:54,61,107` use 7461 as sample input: change to 8787 only where the test is about the proxy's address (keep behaviour).
6. `src/engine/cli.ts:27` probe default refs: `[LOCAL]`.
7. Read the other seed migrations: none may re-enable `strata` or revert the roles/fallbacks; guard if one would, never delete it.
8. Docs (`README.md`, `docs/mcp-guide.md`, `docs/protocol.md`, `repositories.md`): local models through the proxy; `scripts/prod-status.mjs`, `scripts/prod-watch.mjs`: read; if they show Strata/LM Studio as the chat servers, add the proxy (`/healthz`) or leave and say so.
9. `ROADMAP.md` row.

## Out of scope

Removing provider code; the `studios/autostart.ts` ComfyUI-versus-Strata GPU check (Strata still listens on 8080 when the proxy starts it; Gufo 8081 and Llama 8082 are not checked: a follow-up); moving the art-critic to a proxy vision model; the user's data folder.

## Files

`seed/config/providers.md`, `seed/config/roles.md`, `seed/config/settings.md`, `src/shared/schemas.ts`, `src/engine/store/seedMigrations.ts`, `src/engine/models/customProviders.ts`, `src/renderer/ui/ModelsPage.tsx`, `src/engine/cli.ts`, `README.md`, `docs/*`, `ROADMAP.md`. Tests: `tests/seed-migrations.test.ts`, `tests/custom-providers.test.ts`, `tests/models.test.ts` (update assertions on seed defaults).

## Acceptance and tests

- A1 An existing folder whose acp `base_url` is `http://127.0.0.1:7461/v1` gets 8787 on the next start; any other value is left alone; the migration runs once. Test: one table case in `tests/seed-migrations.test.ts` (7461 rewritten, a custom 9999 kept).
- A2 A fresh folder from the seed has acp enabled at 8787 with the six local rows and `strata` disabled; every non-vision role resolves to LOCAL or DeepSeek; `art-critic` resolves to `paid` and the LM Studio row. Check: update the existing seed assertions (`tests/seed-migrations.test.ts:64` and seed tests) instead of a new test.
- A3 `yarn test`, `yarn typecheck`, `yarn build:engine` pass (fnm default alias dir on PATH).
- Live (hub HUB-38 C3; no GPU): the Models page or `vno` status lists the six local acp ids; role defaults show LOCAL.

## ROADMAP row

`- **VNO-67** (2026-11-21, branch \`VNO-67_acp-for-all\`; creative-hub HUB-38, REQ-0030): local models through the ACP proxy. Seed acp on at 8787 with the gufo/strata/llama rows (Inkling listed, not default), migration \`acp-port-8787-v1\` for 7461 folders, roles on \`acp\` (LOCAL = \`acp/strata/qwen3.8-flash-next-unsloth-ud-iq4_xs\`), \`strata\` provider off (code kept); the art-critic keeps LM Studio. Live check UNTESTED.`
