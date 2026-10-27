# VNO-50 Windows packaging scripts

Followed reference: api-acp-proxy (config .cjs, verify-package, pixel-sprite make-icons); scripts bodies use yarn.
Repo has an Electron main (src/main/index.ts, forks out/engine/index.js as utilityProcess; already handles app.isPackaged: --seed resources/seed, icon.png in resources).

## Steps
1. devDependency electron-builder ^26.15.3.
2. electron-builder.config.cjs: appId dev.selak.vn-studio, productName "VN Studio", output release/, files out/**, package.json (no maps); extraResources seed/, themes/, build/icon.png -> icon.png; asarUnpack sharp, @napi-rs/keyring, @img/**; nsis + portable x64 artifact names.
3. src/main/index.ts: packaged -> set VNO_THEMES to resources/themes before engine starts (engine + file server walk up/cwd cannot find themes otherwise).
4. scripts/make-icons.mjs -> build/icon.png, build/icon.ico (pixel sprite, zlib only).
5. scripts/verify-package.mjs: check exe, app.asar, out/{main,preload,renderer,engine}, resources seed/themes/icon, unpacked natives; run engine headless via exe with ELECTRON_RUN_AS_NODE loading sharp + keyring from unpacked tree.
6. package.json scripts dist, dist:installer, dist:portable, dist:dir, verify:package, icons.
7. .gitignore release/; README packaging section; ROADMAP VNO-50.
## Verify
yarn build, dist:dir, verify:package, dist:portable (exe produced). No long launch.
