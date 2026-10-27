# Changelog

## 2026-10-27 VNO-50 Windows packaging scripts
Branch `VNO-50_packaging-scripts` (from master). Followed the api-acp-proxy layout; implemented directly (small change) without implementer children.
- package.json: scripts dist, dist:installer, dist:portable, dist:dir, verify:package, icons (yarn bodies); devDependency electron-builder 26.15.3; yarn.lock.
- electron-builder.config.cjs: appId dev.selak.vn-studio, "VN Studio", output release/, out/** in asar, extraResources seed/themes/icon.png, asarUnpack sharp, @img, @napi-rs, nsis + portable x64.
- src/main/index.ts: packaged app sets VNO_THEMES to resources/themes (engine and font server could not find themes otherwise).
- scripts/make-icons.mjs, build/icon.png, build/icon.ico; scripts/verify-package.mjs; .gitignore release/; README and ROADMAP.
Verification: yarn build, dist:dir, verify:package passed; dist:portable passed (VN-Studio-Portable-0.0.1-x64.exe 103.7 MB).
Not run: NSIS installer, launching the packaged app, signing.
