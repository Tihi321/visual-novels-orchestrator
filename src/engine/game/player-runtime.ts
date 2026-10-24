import fs from 'node:fs'
import path from 'node:path'
import type { GameData } from './emit'
import { renderThemeCss } from '../themes/emit'

/**
 * Generates self-contained HTML5 Visual Novel & Logic Puzzle Web Engine player files.
 */

export function generateIndexHtml(gameData: GameData, extraCss = ''): string {
  const title = gameData.title || 'Visual Novel'
  const isRtl = gameData.rtlLangs.includes(gameData.primaryLang)
  const dir = isRtl ? 'rtl' : 'ltr'
  const pixelClass = gameData.theme.pixel ? ' vno-pixelated' : ''

  return `<!DOCTYPE html>
<html lang="${gameData.primaryLang}" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="fonts/fonts.css">
  <link rel="stylesheet" href="player.css">
  <style>
${extraCss}
  </style>
  <!-- Load game data from script file so file:// protocol works with ZERO CORS issues -->
  <script src="game-data.js"></script>
</head>
<body class="vno-body${pixelClass}">
  <div id="vno-container">
    <div id="vno-stage" class="vno-stage">
      <!-- Background Layer -->
      <div id="vno-bg-layer" class="vno-layer">
        <div id="vno-bg-image" class="vno-bg"></div>
        <div id="vno-black-curtain" class="vno-black-curtain"></div>
      </div>

      <!-- Character Sprites Layer -->
      <div id="vno-sprites-layer" class="vno-layer">
        <div id="vno-slot-left" class="vno-slot vno-slot-left"></div>
        <div id="vno-slot-center" class="vno-slot vno-slot-center"></div>
        <div id="vno-slot-right" class="vno-slot vno-slot-right"></div>
      </div>

      <!-- CG & Insert Overlay Layer -->
      <div id="vno-cg-layer" class="vno-layer vno-hidden">
        <div id="vno-cg-overlay" class="vno-cg-overlay"></div>
        <div id="vno-insert-card" class="vno-insert-card vno-hidden">
          <img id="vno-insert-img" alt="Insert card" src="">
        </div>
      </div>

      <!-- Chapter Title Card -->
      <div id="vno-chapter-card" class="vno-fullscreen-card vno-hidden">
        <div id="vno-chapter-card-text" class="vno-chapter-card-text"></div>
      </div>

      <!-- The End Card -->
      <div id="vno-ending-card" class="vno-fullscreen-card vno-hidden">
        <div id="vno-ending-card-text" class="vno-ending-card-text">The End</div>
        <div class="vno-ending-buttons">
          <button id="vno-btn-restart" class="vno-button">Restart</button>
          <button id="vno-btn-ending-menu" class="vno-button">Main Menu</button>
        </div>
      </div>

      <!-- Dialogue Box -->
      <div id="vno-textbox-container" class="vno-textbox-container">
        <div id="vno-namebox" class="vno-namebox vno-hidden">
          <span id="vno-speaker-name"></span>
        </div>
        <div id="vno-textbox" class="vno-textbox">
          <div id="vno-dialogue-text" class="vno-dialogue-text"></div>
          <div id="vno-typewriter-indicator" class="vno-indicator vno-hidden">&#9660;</div>
        </div>
        <!-- Quick Menu -->
        <div id="vno-quick-menu" class="vno-quick-menu">
          <button id="vno-qm-back" class="vno-qm-btn" title="Rollback (PageUp / Left)">Back</button>
          <button id="vno-qm-history" class="vno-qm-btn" title="Dialogue History">History</button>
          <button id="vno-qm-skip" class="vno-qm-btn" title="Skip Text (Ctrl)">Skip</button>
          <button id="vno-qm-auto" class="vno-qm-btn" title="Auto Forward">Auto</button>
          <button id="vno-qm-save" class="vno-qm-btn" title="Save Game">Save</button>
          <button id="vno-qm-qsave" class="vno-qm-btn" title="Quick Save">Q.Save</button>
          <button id="vno-qm-qload" class="vno-qm-btn" title="Quick Load">Q.Load</button>
          <button id="vno-qm-prefs" class="vno-qm-btn" title="Preferences">Prefs</button>
          <button id="vno-qm-menu" class="vno-qm-btn" title="Main Menu">Menu</button>
        </div>
      </div>

      <!-- Branching Choices Overlay -->
      <div id="vno-choice-overlay" class="vno-overlay vno-hidden">
        <div id="vno-choice-container" class="vno-choice-container"></div>
      </div>

      <!-- Interactive Puzzle / Mini-Game Overlay -->
      <div id="vno-puzzle-overlay" class="vno-overlay vno-hidden">
        <div id="vno-puzzle-container" class="vno-puzzle-container">
          <div id="vno-puzzle-header" class="vno-puzzle-header">
            <h2 id="vno-puzzle-title">Puzzle</h2>
            <div id="vno-puzzle-header-actions">
              <button id="vno-puzzle-btn-hint" class="vno-button vno-btn-hint">Hint</button>
              <button id="vno-puzzle-btn-giveup" class="vno-button vno-btn-giveup">Give Up</button>
            </div>
          </div>
          <div id="vno-puzzle-body" class="vno-puzzle-body"></div>
        </div>
      </div>

      <!-- Screens: Main Menu, Save/Load, Preferences, History -->
      <!-- Main Menu Screen -->
      <div id="vno-screen-main-menu" class="vno-screen">
        <div class="vno-main-menu-bg"></div>
        <div class="vno-main-menu-content">
          <h1 id="vno-mm-title" class="vno-main-menu-title">${escapeHtml(title)}</h1>
          <div class="vno-main-menu-buttons">
            <button id="vno-mm-start" class="vno-menu-btn">Start</button>
            <button id="vno-mm-load" class="vno-menu-btn">Load</button>
            <button id="vno-mm-prefs" class="vno-menu-btn">Preferences</button>
            <button id="vno-mm-about" class="vno-menu-btn">About</button>
          </div>
        </div>
      </div>

      <!-- History Screen -->
      <div id="vno-screen-history" class="vno-screen vno-hidden">
        <div class="vno-screen-panel">
          <div class="vno-screen-header">
            <h2 id="vno-history-title">History</h2>
            <button class="vno-screen-close">&times;</button>
          </div>
          <div id="vno-history-list" class="vno-screen-body vno-history-list"></div>
        </div>
      </div>

      <!-- Save / Load Screen -->
      <div id="vno-screen-save" class="vno-screen vno-hidden">
        <div class="vno-screen-panel">
          <div class="vno-screen-header">
            <h2 id="vno-save-screen-title">Save Game</h2>
            <button class="vno-screen-close">&times;</button>
          </div>
          <div class="vno-save-pages">
            <button class="vno-page-btn" data-page="1">1</button>
            <button class="vno-page-btn" data-page="2">2</button>
            <button class="vno-page-btn" data-page="3">3</button>
            <button class="vno-page-btn" data-page="4">4</button>
            <button class="vno-page-btn" data-page="5">5</button>
            <button class="vno-page-btn" data-page="6">6</button>
            <button class="vno-page-btn" data-page="7">7</button>
            <button class="vno-page-btn" data-page="8">8</button>
            <button class="vno-page-btn" data-page="9">9</button>
            <button class="vno-page-btn" data-page="auto">Auto</button>
            <button class="vno-page-btn" data-page="quick">Quick</button>
          </div>
          <div id="vno-save-slots-grid" class="vno-save-slots-grid"></div>
        </div>
      </div>

      <!-- Preferences Screen -->
      <div id="vno-screen-prefs" class="vno-screen vno-hidden">
        <div class="vno-screen-panel">
          <div class="vno-screen-header">
            <h2 id="vno-prefs-title">Preferences</h2>
            <button class="vno-screen-close">&times;</button>
          </div>
          <div class="vno-screen-body vno-prefs-body">
            <div class="vno-pref-group">
              <label id="vno-pref-label-display">Display</label>
              <div class="vno-pref-control">
                <button id="vno-pref-fullscreen" class="vno-button">Toggle Fullscreen</button>
              </div>
            </div>
            <div class="vno-pref-group">
              <label id="vno-pref-label-language">Language</label>
              <div class="vno-pref-control">
                <select id="vno-pref-language" class="vno-select"></select>
              </div>
            </div>
            <div class="vno-pref-group">
              <label id="vno-pref-label-text-speed">Text Speed</label>
              <div class="vno-pref-control">
                <input id="vno-pref-text-speed" type="range" min="1" max="100" value="50">
              </div>
            </div>
            <div class="vno-pref-group">
              <label id="vno-pref-label-auto-delay">Auto-Forward Delay</label>
              <div class="vno-pref-control">
                <input id="vno-pref-auto-delay" type="range" min="1" max="10" value="4">
              </div>
            </div>
            <div class="vno-pref-group">
              <label id="vno-pref-label-vol-music">Music Volume</label>
              <div class="vno-pref-control">
                <input id="vno-pref-vol-music" type="range" min="0" max="100" value="80">
              </div>
            </div>
            <div class="vno-pref-group">
              <label id="vno-pref-label-vol-sfx">Sound Effects Volume</label>
              <div class="vno-pref-control">
                <input id="vno-pref-vol-sfx" type="range" min="0" max="100" value="80">
              </div>
            </div>
            <div class="vno-pref-group">
              <label id="vno-pref-label-vol-voice">Voice Volume</label>
              <div class="vno-pref-control">
                <input id="vno-pref-vol-voice" type="range" min="0" max="100" value="90">
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- About Screen -->
      <div id="vno-screen-about" class="vno-screen vno-hidden">
        <div class="vno-screen-panel">
          <div class="vno-screen-header">
            <h2 id="vno-about-title">About</h2>
            <button class="vno-screen-close">&times;</button>
          </div>
          <div class="vno-screen-body">
            <h3 id="vno-about-book-title">${escapeHtml(title)}</h3>
            <p>Powered by Visual Novels Orchestrator HTML5 Game Engine.</p>
          </div>
        </div>
      </div>

      <!-- Persistent Stage Language Switcher (accessible on every screen) -->
      <div id="vno-lang-bar" class="vno-lang-bar" title="Language">
        <label for="vno-stage-language" id="vno-lang-bar-label" class="vno-lang-bar-label">&#127760;</label>
        <select id="vno-stage-language" class="vno-lang-select" aria-label="Language"></select>
      </div>

      <!-- Audio Elements -->
      <audio id="vno-audio-music" loop preload="auto"></audio>
      <audio id="vno-audio-ambience" loop preload="auto"></audio>
      <audio id="vno-audio-sfx" preload="auto"></audio>
      <audio id="vno-audio-voice" preload="auto"></audio>
    </div>
  </div>

  <script src="player.js"></script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function generatePlayerCss(gameData: GameData): string {
  const pixelCss = gameData.theme.pixel ? 'image-rendering: pixelated; image-rendering: crisp-edges;' : ''

  return `
/* VN Studio HTML5 Visual Novel Engine Stylesheet */
* {
  box-sizing: border-box;
  user-select: none;
  -webkit-user-select: none;
  margin: 0;
  padding: 0;
}

body.vno-body {
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background-color: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--vno-font-text, sans-serif);
  color: var(--vno-color-text, #fff);
  ${pixelCss}
}

.vno-pixelated {
  ${pixelCss}
}

#vno-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

#vno-stage {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  background-color: var(--vno-color-bg, #101018);
  transform-origin: center center;
  transform: translate(-50%, -50%) scale(1);
}

/* Layers */
.vno-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.vno-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transition: opacity var(--vno-transition-dissolve, 0.6s) ease;
}

.vno-black-curtain {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: #000;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--vno-transition-fade, 0.6s) ease;
}

.vno-black-curtain.active {
  opacity: 1;
}

/* Sprites */
.vno-slot {
  position: absolute;
  bottom: 0;
  height: 85%;
  width: min(640px, 35%);
  transform: translateX(-50%);
  display: flex;
  justify-content: center;
  align-items: flex-end;
  pointer-events: none;
}

.vno-slot-left { left: 22%; }
.vno-slot-center { left: 50%; }
.vno-slot-right { left: 78%; }

.vno-sprite-img {
  max-height: 100%;
  max-width: 100%;
  object-fit: contain;
  object-position: bottom center;
  transition: opacity var(--vno-transition-show, 0.25s) ease, filter 0.3s ease;
}

/* CG & Insert */
.vno-cg-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transition: opacity var(--vno-transition-dissolve, 0.6s) ease;
}

.vno-insert-card {
  position: absolute;
  top: 42%;
  left: 50%;
  transform: translate(-50%, -50%);
  max-width: 70%;
  max-height: 70%;
  background: rgba(0,0,0,0.85);
  border: 4px solid var(--vno-color-accent, #555);
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.8);
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vno-insert-card img {
  max-height: 600px;
  max-width: 800px;
  object-fit: contain;
}

/* Dialogue Box */
.vno-textbox-container {
  position: absolute;
  bottom: 20px;
  left: 36px;
  right: 36px;
  height: 278px;
  pointer-events: auto;
  cursor: pointer;
}

.vno-textbox {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--vno-textbox-bg, rgba(0,0,0,0.75));
  border-radius: var(--vno-textbox-radius, 8px);
  border: var(--vno-textbox-border, none);
  padding: 40px 60px 40px 60px;
}

.vno-namebox {
  position: absolute;
  top: -27px;
  left: 60px;
  min-width: 240px;
  height: 48px;
  background: var(--vno-namebox-bg, rgba(20,20,20,0.95));
  border-radius: var(--vno-namebox-radius, 4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 24px;
  z-index: 10;
  color: var(--vno-namebox-text-color, var(--vno-color-accent, #ffcc00));
  font-family: var(--vno-font-name, var(--vno-font-text));
  font-size: var(--vno-size-name, 40px);
  font-weight: bold;
}

[dir="rtl"] .vno-namebox {
  left: auto;
  right: 60px;
}

.vno-dialogue-text {
  font-family: var(--vno-font-text);
  font-size: var(--vno-size-text, 33px);
  line-height: 1.4;
  color: var(--vno-color-text, #fff);
  word-wrap: break-word;
}

[dir="rtl"] .vno-dialogue-text {
  text-align: right;
  direction: rtl;
}

.vno-indicator {
  position: absolute;
  right: 30px;
  bottom: 15px;
  font-size: 24px;
  color: var(--vno-color-accent, #fff);
  animation: vno-bounce 1s infinite;
}

@keyframes vno-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

/* Quick Menu */
.vno-quick-menu {
  position: absolute;
  right: 20px;
  bottom: 10px;
  display: flex;
  gap: 12px;
  z-index: 20;
}

[dir="rtl"] .vno-quick-menu {
  right: auto;
  left: 20px;
}

.vno-qm-btn {
  background: transparent;
  border: none;
  color: var(--vno-color-idle, #aaa);
  font-family: var(--vno-font-interface, sans-serif);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}

.vno-qm-btn:hover {
  color: var(--vno-color-hover, #fff);
  background: rgba(255,255,255,0.1);
}

/* Choice Menu */
.vno-choice-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  max-width: 1200px;
  width: 90%;
}

.vno-choice-btn {
  width: 100%;
  padding: 16px 40px;
  background: var(--vno-choice-bg, rgba(0,0,0,0.85));
  border: var(--vno-choice-border, 2px solid #444);
  border-radius: var(--vno-choice-radius, 8px);
  color: var(--vno-choice-text-color, #ccc);
  font-family: var(--vno-font-text, sans-serif);
  font-size: var(--vno-size-choice, 32px);
  text-align: center;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, transform 0.1s;
}

.vno-choice-btn:hover {
  background: var(--vno-choice-hover-bg, rgba(40,40,60,0.95));
  color: var(--vno-choice-hover-text-color, #fff);
  transform: scale(1.02);
}

/* Fullscreen Cards */
.vno-fullscreen-card {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: #000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 50;
  cursor: pointer;
}

.vno-chapter-card-text {
  font-size: var(--vno-size-title, 75px);
  font-family: var(--vno-font-name, var(--vno-font-text));
  color: var(--vno-color-accent, #fff);
  text-align: center;
  padding: 0 40px;
}

.vno-ending-card-text {
  font-size: var(--vno-size-title, 75px);
  margin-bottom: 40px;
}

.vno-ending-buttons {
  display: flex;
  gap: 24px;
}

/* Screens */
.vno-screen {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.85);
}

.vno-screen-panel {
  width: 1400px;
  height: 850px;
  background: var(--vno-color-bg, #181824);
  border: 2px solid var(--vno-color-accent, #333);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.9);
}

.vno-screen-header {
  padding: 20px 30px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.vno-screen-header h2 {
  font-size: var(--vno-size-title, 48px);
  color: var(--vno-color-accent, #fff);
}

.vno-screen-close {
  background: transparent;
  border: none;
  color: #fff;
  font-size: 40px;
  cursor: pointer;
}

.vno-screen-body {
  flex: 1;
  padding: 30px;
  overflow-y: auto;
}

/* Main Menu */
#vno-screen-main-menu {
  background: #000;
}

.vno-main-menu-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-image: url('gui/main_menu.png');
  background-size: cover;
  background-position: center;
}

.vno-main-menu-content {
  position: absolute;
  left: 120px;
  top: 180px;
  display: flex;
  flex-direction: column;
  gap: 30px;
  z-index: 10;
}

[dir="rtl"] .vno-main-menu-content {
  left: auto;
  right: 120px;
}

.vno-main-menu-title {
  font-size: 80px;
  color: var(--vno-color-accent, #fff);
  text-shadow: 0 4px 16px rgba(0,0,0,0.8);
}

.vno-main-menu-buttons {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 380px;
}

.vno-menu-btn, .vno-button {
  padding: 14px 28px;
  background: var(--vno-choice-bg, rgba(20,20,20,0.85));
  border: 1px solid var(--vno-color-idle, #444);
  border-radius: 6px;
  color: var(--vno-color-text, #fff);
  font-family: var(--vno-font-interface, sans-serif);
  font-size: 26px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

[dir="rtl"] .vno-menu-btn {
  text-align: right;
}

.vno-menu-btn:hover, .vno-button:hover {
  background: var(--vno-color-hover, #444);
  color: var(--vno-color-selected, #fff);
  border-color: var(--vno-color-accent, #888);
}

/* Save Slots */
.vno-save-pages {
  display: flex;
  gap: 12px;
  padding: 12px 30px;
  background: rgba(0,0,0,0.3);
}

.vno-page-btn {
  padding: 8px 18px;
  background: rgba(255,255,255,0.08);
  border: 1px solid #444;
  color: #ccc;
  border-radius: 4px;
  cursor: pointer;
  font-size: 20px;
}

.vno-page-btn.active {
  background: var(--vno-color-accent, #0077cc);
  color: #fff;
  border-color: #fff;
}

.vno-save-slots-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  padding: 24px;
  overflow-y: auto;
}

.vno-slot-card {
  height: 200px;
  background: rgba(0,0,0,0.4);
  border: 1px solid #444;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.vno-slot-card:hover {
  border-color: var(--vno-color-accent, #aaa);
  background: rgba(255,255,255,0.05);
}

/* Preferences */
.vno-prefs-body {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.vno-pref-group {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 26px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.vno-pref-control {
  width: 500px;
  display: flex;
  align-items: center;
}

.vno-pref-control input[type="range"] {
  width: 100%;
}

.vno-select {
  width: 100%;
  padding: 8px 12px;
  background: #222;
  color: #fff;
  border: 1px solid #555;
  border-radius: 4px;
  font-size: 22px;
}

/* Puzzle UI Styles */
.vno-puzzle-container {
  width: 1700px;
  height: 960px;
  background: rgba(16, 18, 28, 0.96);
  border: 2px solid var(--vno-color-accent, #555);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  padding: 24px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.9);
}

.vno-puzzle-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 16px;
  border-bottom: 2px solid rgba(255,255,255,0.1);
}

.vno-puzzle-body {
  flex: 1;
  display: flex;
  gap: 30px;
  margin-top: 16px;
  overflow: hidden;
}

.vno-puzzle-left-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  padding-right: 12px;
}

.vno-puzzle-right-col {
  flex: 1.4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

/* Deduction Grid Table */
.vno-deduction-grid {
  border-collapse: collapse;
  background: rgba(0,0,0,0.3);
}

.vno-deduction-grid th, .vno-deduction-grid td {
  border: 1px solid rgba(255,255,255,0.2);
  width: 48px;
  height: 48px;
  text-align: center;
  vertical-align: middle;
  font-size: 24px;
  cursor: pointer;
}

.vno-deduction-grid th {
  background: rgba(255,255,255,0.05);
  font-size: 14px;
  padding: 4px;
  max-width: 80px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vno-mark-true { color: #4ade80; font-weight: bold; }
.vno-mark-false { color: #f87171; font-weight: bold; }

/* Clues List */
.vno-clue-item {
  padding: 10px 14px;
  background: rgba(255,255,255,0.04);
  border-radius: 6px;
  font-size: 20px;
  cursor: pointer;
  transition: opacity 0.2s, background 0.2s;
}

.vno-clue-item.struck {
  text-decoration: line-through;
  opacity: 0.4;
}

/* Modals & Overlays */
.vno-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0,0,0,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}

/* Persistent Stage Language Bar */
.vno-lang-bar {
  position: absolute;
  top: 20px;
  right: 28px;
  z-index: 200;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(16, 18, 28, 0.85);
  border: 1px solid var(--vno-color-idle, #555);
  border-radius: 6px;
  padding: 6px 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
}

[dir="rtl"] .vno-lang-bar {
  right: auto;
  left: 28px;
}

.vno-lang-bar-label {
  font-size: 20px;
  line-height: 1;
  color: var(--vno-color-accent, #fff);
  cursor: pointer;
}

.vno-lang-select {
  background: transparent;
  color: var(--vno-color-text, #fff);
  border: none;
  font-family: var(--vno-font-interface, sans-serif);
  font-size: 20px;
  cursor: pointer;
  outline: none;
  padding-right: 4px;
}

.vno-lang-select option {
  background: #181824;
  color: #fff;
}

.vno-hidden {
  display: none !important;
}
`
}

export function generatePlayerJs(): string {
  return `/**
 * Visual Novels Orchestrator (VNO) HTML5 & TypeScript Visual Novel Runtime
 */
(function() {
  'use strict';

  // State Management
  let gameData = null;
  let currentLang = 'en';
  let currentEdition = null;
  let currentChapterIdx = 0;
  let currentSceneIdx = 0;
  let currentBeatIdx = -1;

  let typewriterTimer = null;
  let autoTimer = null;
  let isTyping = false;
  let currentFullText = '';

  let activeChoices = null;
  let activeEndingMsg = null;
  let activePuzzle = null;
  let activeSaveScreen = { page: 1, isSaving: false };

  let settings = {
    textSpeed: 50,
    autoDelay: 4,
    volMusic: 80,
    volSfx: 80,
    volVoice: 90,
    skipUnseen: false
  };

  const stateHistory = [];
  const dialogueHistory = [];
  const seenBeats = new Set();
  const puzzleHandlers = new Map();
  const beatHandlers = new Map();

  // DOM Elements cache
  let dom = {};

  function init() {
    cacheDom();
    setupVirtualStage();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    if (typeof ResizeObserver !== 'undefined' && dom.container) {
      new ResizeObserver(handleResize).observe(dom.container);
    }
    setupAutoplayUnlock();
    handleResize();

    loadSettings();
    bindKeyboardShortcuts();
    bindUiEvents();

    if (window.VNO_GAME_DATA) {
      loadGameData(window.VNO_GAME_DATA);
    } else {
      fetch('game-data.json')
        .then(res => res.json())
        .then(data => loadGameData(data))
        .catch(err => {
          console.warn('Could not fetch game-data.json, relying on window.VNO_GAME_DATA:', err);
        });
    }
  }

  function cacheDom() {
    dom.container = document.getElementById('vno-container');
    dom.stage = document.getElementById('vno-stage');
    dom.bgImage = document.getElementById('vno-bg-image');
    dom.blackCurtain = document.getElementById('vno-black-curtain');
    dom.slotLeft = document.getElementById('vno-slot-left');
    dom.slotCenter = document.getElementById('vno-slot-center');
    dom.slotRight = document.getElementById('vno-slot-right');
    dom.cgLayer = document.getElementById('vno-cg-layer');
    dom.cgOverlay = document.getElementById('vno-cg-overlay');
    dom.insertCard = document.getElementById('vno-insert-card');
    dom.insertImg = document.getElementById('vno-insert-img');
    dom.chapterCard = document.getElementById('vno-chapter-card');
    dom.chapterCardText = document.getElementById('vno-chapter-card-text');
    dom.endingCard = document.getElementById('vno-ending-card');
    dom.endingCardText = document.getElementById('vno-ending-card-text');
    dom.textboxContainer = document.getElementById('vno-textbox-container');
    dom.textbox = document.getElementById('vno-textbox');
    dom.namebox = document.getElementById('vno-namebox');
    dom.speakerName = document.getElementById('vno-speaker-name');
    dom.dialogueText = document.getElementById('vno-dialogue-text');
    dom.indicator = document.getElementById('vno-typewriter-indicator');
    dom.choiceOverlay = document.getElementById('vno-choice-overlay');
    dom.choiceContainer = document.getElementById('vno-choice-container');
    dom.puzzleOverlay = document.getElementById('vno-puzzle-overlay');
    dom.puzzleTitle = document.getElementById('vno-puzzle-title');
    dom.puzzleBody = document.getElementById('vno-puzzle-body');
    dom.mainMenu = document.getElementById('vno-screen-main-menu');
    dom.screenSave = document.getElementById('vno-screen-save');
    dom.screenPrefs = document.getElementById('vno-screen-prefs');
    dom.screenHistory = document.getElementById('vno-screen-history');
    dom.screenAbout = document.getElementById('vno-screen-about');
    dom.langBar = document.getElementById('vno-lang-bar');
    dom.stageLanguage = document.getElementById('vno-stage-language');
    dom.prefLanguage = document.getElementById('vno-pref-language');
    dom.audioMusic = document.getElementById('vno-audio-music');
    dom.audioAmbience = document.getElementById('vno-audio-ambience');
    dom.audioSfx = document.getElementById('vno-audio-sfx');
    dom.audioVoice = document.getElementById('vno-audio-voice');
  }

  function setupVirtualStage() {
    if (!dom.stage) return;
    dom.stage.style.width = '1920px';
    dom.stage.style.height = '1080px';
  }

  function handleResize() {
    if (!dom.stage) return;
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    const scale = Math.min(ww / 1920, wh / 1080);
    dom.stage.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
    dom.stage.style.left = '50%';
    dom.stage.style.top = '50%';
  }

  function setupAutoplayUnlock() {
    const unlock = () => {
      if (dom.audioMusic && dom.audioMusic.paused && dom.audioMusic.src) {
        dom.audioMusic.play().catch(() => {});
      }
    };
    ['click', 'pointerdown', 'keydown'].forEach(evt => {
      window.addEventListener(evt, unlock);
    });
  }

  function populateLanguageSelect(selectEl) {
    if (!selectEl || !gameData || !gameData.languages) return;
    selectEl.innerHTML = '';
    gameData.languages.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.code;
      opt.textContent = l.nativeName && l.nativeName !== l.name ? (l.nativeName + ' (' + l.name + ')') : (l.nativeName || l.name || l.code);
      if (l.code === currentLang) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  function loadGameData(data) {
    gameData = data;
    currentLang = gameData.primaryLang || 'en';
    currentEdition = gameData.editions ? gameData.editions[currentLang] : null;

    populateLanguageSelect(dom.stageLanguage);
    populateLanguageSelect(dom.prefLanguage);

    applyLanguageTypography();
    updateUiStrings();
    applyAudioVolumes();

    // Play Main Menu Music if available
    if (gameData.audio && gameData.audio.music && gameData.audio.music.music_01) {
      playMusic('music_01');
    }
  }

  function switchLanguage(langCode) {
    if (!gameData || !gameData.editions || !gameData.editions[langCode]) return;
    currentLang = langCode;
    currentEdition = gameData.editions[langCode];

    if (dom.stageLanguage && dom.stageLanguage.value !== langCode) {
      dom.stageLanguage.value = langCode;
    }
    if (dom.prefLanguage && dom.prefLanguage.value !== langCode) {
      dom.prefLanguage.value = langCode;
    }

    applyLanguageTypography();
    updateUiStrings();
    refreshActiveScreens();
  }

  function applyLanguageTypography() {
    if (!gameData) return;
    const isRtl = Boolean(
      (gameData.rtlLangs && gameData.rtlLangs.includes(currentLang)) ||
      (gameData.languages && gameData.languages.some(l => l.code === currentLang && l.rtl))
    );
    document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', currentLang);

    const langEntry = gameData.languages ? gameData.languages.find(l => l.code === currentLang) : null;
    const fontFamily = (langEntry && langEntry.fontFamily) || 'var(--vno-font-text, sans-serif)';
    if (dom.stage) dom.stage.style.fontFamily = fontFamily;
    if (dom.dialogueText) dom.dialogueText.style.fontFamily = fontFamily;
  }

  function ui(key, fallback) {
    if (currentEdition && currentEdition.ui && currentEdition.ui[key]) {
      return currentEdition.ui[key];
    }
    return fallback !== undefined ? fallback : key;
  }

  function setElemText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function updateUiStrings() {
    if (!gameData) return;
    const bookTitle = (currentEdition && currentEdition.title) || gameData.title || 'Visual Novel';
    document.title = bookTitle;
    setElemText('vno-mm-title', bookTitle);
    setElemText('vno-about-book-title', bookTitle);

    // Main Menu
    setElemText('vno-mm-start', ui('Start', 'Start'));
    setElemText('vno-mm-load', ui('Load', 'Load'));
    setElemText('vno-mm-prefs', ui('Preferences', 'Preferences'));
    setElemText('vno-mm-about', ui('About', 'About'));

    // Quick Menu
    setElemText('vno-qm-back', ui('Back', 'Back'));
    setElemText('vno-qm-history', ui('History', 'History'));
    setElemText('vno-qm-skip', ui('Skip', 'Skip'));
    setElemText('vno-qm-auto', ui('Auto', 'Auto'));
    setElemText('vno-qm-save', ui('Save', 'Save'));
    setElemText('vno-qm-qsave', ui('Q.Save', 'Q.Save'));
    setElemText('vno-qm-qload', ui('Q.Load', 'Q.Load'));
    setElemText('vno-qm-prefs', ui('Prefs', 'Prefs'));
    setElemText('vno-qm-menu', ui('Menu', 'Menu'));

    // Ending Buttons
    setElemText('vno-btn-restart', ui('Start again', 'Restart'));
    setElemText('vno-btn-ending-menu', ui('Main Menu', 'Main Menu'));

    // Modal Headers & Preferences Labels
    setElemText('vno-history-title', ui('History', 'History'));
    setElemText('vno-prefs-title', ui('Preferences', 'Preferences'));
    setElemText('vno-about-title', ui('About', 'About'));
    setElemText('vno-pref-label-display', ui('Display', 'Display'));
    setElemText('vno-pref-fullscreen', ui('Fullscreen', 'Toggle Fullscreen'));
    setElemText('vno-pref-label-language', ui('Language', 'Language'));
    setElemText('vno-pref-label-text-speed', ui('Text Speed', 'Text Speed'));
    setElemText('vno-pref-label-auto-delay', ui('Auto-Forward Time', 'Auto-Forward Delay'));
    setElemText('vno-pref-label-vol-music', ui('Music Volume', 'Music Volume'));
    setElemText('vno-pref-label-vol-sfx', ui('Sound Volume', 'Sound Effects Volume'));
    setElemText('vno-pref-label-vol-voice', ui('Voice Volume', 'Voice Volume'));

    // Stage Language Bar tooltip & aria-label
    const langLabel = ui('Language', 'Language');
    if (dom.langBar) dom.langBar.title = langLabel;
    if (dom.stageLanguage) dom.stageLanguage.setAttribute('aria-label', langLabel);
  }

  function refreshActiveScreens() {
    if (!gameData) return;

    // 1. Active Dialogue / Narration Beat
    updateCurrentDialogueDisplay();

    // 2. Chapter Title Card
    if (dom.chapterCard && !dom.chapterCard.classList.contains('vno-hidden')) {
      const ch = gameData.chapters[currentChapterIdx];
      dom.chapterCardText.textContent = getLocalizedChapterTitle(currentChapterIdx, ch ? ch.title : '');
    }

    // 3. Branching Choices Overlay
    if (dom.choiceOverlay && !dom.choiceOverlay.classList.contains('vno-hidden') && activeChoices) {
      showChoices(activeChoices);
    }

    // 4. Ending Card
    if (dom.endingCard && !dom.endingCard.classList.contains('vno-hidden')) {
      const ch = gameData.chapters[currentChapterIdx];
      const localizedEnding =
        (currentEdition && currentEdition.endings && ch && currentEdition.endings[ch.number]) ||
        activeEndingMsg ||
        ui('The End', 'The End');
      dom.endingCardText.textContent = localizedEnding;
    }

    // 5. Interactive Puzzle Overlay
    if (dom.puzzleOverlay && !dom.puzzleOverlay.classList.contains('vno-hidden') && activePuzzle) {
      renderBuiltinPuzzle(activePuzzle.pz, activePuzzle.onFail, activePuzzle.struckClues);
    }

    // 6. History Screen
    if (dom.screenHistory && !dom.screenHistory.classList.contains('vno-hidden')) {
      renderHistoryList();
    }

    // 7. Save / Load Screen
    if (dom.screenSave && !dom.screenSave.classList.contains('vno-hidden') && activeSaveScreen) {
      setElemText('vno-save-screen-title', activeSaveScreen.isSaving ? ui('Save', 'Save Game') : ui('Load', 'Load Game'));
      renderSaveSlots(activeSaveScreen.page, activeSaveScreen.isSaving);
    }
  }

  function applyAudioVolumes() {
    if (dom.audioMusic) dom.audioMusic.volume = settings.volMusic / 100;
    if (dom.audioAmbience) dom.audioAmbience.volume = settings.volSfx / 100;
    if (dom.audioSfx) dom.audioSfx.volume = settings.volSfx / 100;
    if (dom.audioVoice) dom.audioVoice.volume = settings.volVoice / 100;
  }

  function bindUiEvents() {
    // Stop propagation on persistent stage language bar so dropdown interaction never advances stage or dismisses cards
    if (dom.langBar) {
      ['click', 'mousedown', 'mouseup', 'touchstart', 'keydown'].forEach(evt => {
        dom.langBar.addEventListener(evt, (e) => e.stopPropagation());
      });
    }
    if (dom.stageLanguage) {
      dom.stageLanguage.addEventListener('change', (e) => switchLanguage(e.target.value));
    }
    if (dom.prefLanguage) {
      dom.prefLanguage.addEventListener('change', (e) => switchLanguage(e.target.value));
    }

    // Stage Advance on Click
    dom.textboxContainer.addEventListener('click', onAdvanceClick);

    // Main Menu Buttons
    document.getElementById('vno-mm-start').addEventListener('click', startGame);
    document.getElementById('vno-mm-load').addEventListener('click', () => openSaveScreen(false));
    document.getElementById('vno-mm-prefs').addEventListener('click', () => openScreen(dom.screenPrefs));
    document.getElementById('vno-mm-about').addEventListener('click', () => openScreen(dom.screenAbout));

    // Ending Buttons
    document.getElementById('vno-btn-restart').addEventListener('click', startGame);
    document.getElementById('vno-btn-ending-menu').addEventListener('click', returnToMainMenu);

    // Quick Menu Buttons
    document.getElementById('vno-qm-back').addEventListener('click', rollback);
    document.getElementById('vno-qm-history').addEventListener('click', openHistoryScreen);
    document.getElementById('vno-qm-save').addEventListener('click', () => openSaveScreen(true));
    document.getElementById('vno-qm-qsave').addEventListener('click', quickSave);
    document.getElementById('vno-qm-qload').addEventListener('click', quickLoad);
    document.getElementById('vno-qm-prefs').addEventListener('click', () => openScreen(dom.screenPrefs));
    document.getElementById('vno-qm-menu').addEventListener('click', returnToMainMenu);

    // Close buttons for modals
    document.querySelectorAll('.vno-screen-close').forEach(btn => {
      btn.addEventListener('click', closeAllScreens);
    });

    // Preferences Sliders
    document.getElementById('vno-pref-fullscreen').addEventListener('click', toggleFullscreen);
    bindRange('vno-pref-text-speed', 'textSpeed');
    bindRange('vno-pref-auto-delay', 'autoDelay');
    bindRange('vno-pref-vol-music', 'volMusic', applyAudioVolumes);
    bindRange('vno-pref-vol-sfx', 'volSfx', applyAudioVolumes);
    bindRange('vno-pref-vol-voice', 'volVoice', applyAudioVolumes);
  }

  function bindRange(elemId, key, callback) {
    const el = document.getElementById(elemId);
    if (!el) return;
    el.value = settings[key];
    el.addEventListener('input', (e) => {
      settings[key] = Number(e.target.value);
      saveSettings();
      if (callback) callback();
    });
  }

  function bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
      if (dom.mainMenu && !dom.mainMenu.classList.contains('vno-hidden')) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        onAdvanceClick();
      } else if (e.code === 'PageUp' || e.code === 'ArrowLeft') {
        e.preventDefault();
        rollback();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        if (!dom.screenPrefs.classList.contains('vno-hidden')) closeAllScreens();
        else openScreen(dom.screenPrefs);
      } else if (e.key === 'f' || e.key === 'F' || e.code === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      }
    });
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  function startGame() {
    closeAllScreens();
    dom.mainMenu.classList.add('vno-hidden');
    dom.endingCard.classList.add('vno-hidden');
    dom.choiceOverlay.classList.add('vno-hidden');
    dom.puzzleOverlay.classList.add('vno-hidden');
    activeChoices = null;
    activeEndingMsg = null;
    activePuzzle = null;
    currentChapterIdx = 0;
    currentSceneIdx = 0;
    currentBeatIdx = -1;
    stateHistory.length = 0;
    dialogueHistory.length = 0;
    seenBeats.clear();

    playChapter(0);
  }

  function returnToMainMenu() {
    closeAllScreens();
    dom.endingCard.classList.add('vno-hidden');
    dom.choiceOverlay.classList.add('vno-hidden');
    dom.puzzleOverlay.classList.add('vno-hidden');
    dom.chapterCard.classList.add('vno-hidden');
    activeChoices = null;
    activeEndingMsg = null;
    activePuzzle = null;
    dom.mainMenu.classList.remove('vno-hidden');
    stopVoice();
    if (gameData && gameData.audio && gameData.audio.music && gameData.audio.music.music_01) {
      playMusic('music_01');
    }
  }

  function playChapter(chIdx) {
    if (!gameData.chapters[chIdx]) {
      returnToMainMenu();
      return;
    }
    currentChapterIdx = chIdx;
    currentSceneIdx = 0;
    currentBeatIdx = -1;

    const ch = gameData.chapters[chIdx];
    showChapterCard(ch.title, () => {
      playScene(0);
    });
  }

  function showChapterCard(title, onFinish) {
    if (!title || !title.trim()) {
      onFinish();
      return;
    }
    dom.chapterCardText.textContent = getLocalizedChapterTitle(currentChapterIdx, title);
    dom.chapterCard.classList.remove('vno-hidden');
    dom.chapterCard.onclick = () => {
      dom.chapterCard.classList.add('vno-hidden');
      dom.chapterCard.onclick = null;
      onFinish();
    };
    setTimeout(() => {
      if (!dom.chapterCard.classList.contains('vno-hidden')) {
        dom.chapterCard.classList.add('vno-hidden');
        dom.chapterCard.onclick = null;
        onFinish();
      }
    }, 2500);
  }

  function playScene(scIdx) {
    const ch = gameData.chapters[currentChapterIdx];
    if (!ch || !ch.scenes[scIdx]) return;
    currentSceneIdx = scIdx;
    currentBeatIdx = -1;
    const scene = ch.scenes[scIdx];

    // Clear stage slots & CG overlays when starting a new scene
    dom.slotLeft.innerHTML = '';
    if (dom.slotLeft.setAttribute) dom.slotLeft.setAttribute('data-char', '');
    dom.slotCenter.innerHTML = '';
    if (dom.slotCenter.setAttribute) dom.slotCenter.setAttribute('data-char', '');
    dom.slotRight.innerHTML = '';
    if (dom.slotRight.setAttribute) dom.slotRight.setAttribute('data-char', '');
    dom.cgLayer.classList.add('vno-hidden');
    dom.cgOverlay.classList.add('vno-hidden');
    dom.insertCard.classList.add('vno-hidden');

    // Background transition
    if (scene.bgPath) {
      dom.bgImage.style.backgroundImage = 'url("' + scene.bgPath + '")';
    } else {
      dom.bgImage.style.backgroundImage = 'none';
    }

    // Music
    if (scene.music) {
      playMusic(scene.music, scene.musicLoopStartSec);
    } else if (scene.music === null && scene.musicExplicitNull) {
      stopMusic();
    }

    // Ambience
    if (scene.ambience) {
      playAmbience(scene.ambience);
    }

    advance();
  }

  function onAdvanceClick() {
    if (isTyping) {
      // Reveal immediately
      completeTypewriter();
      return;
    }
    advance();
  }

  function advance() {
    clearTimeout(autoTimer);
    const ch = gameData.chapters[currentChapterIdx];
    if (!ch) return;
    const sc = ch.scenes[currentSceneIdx];
    if (!sc) return;

    currentBeatIdx++;
    if (currentBeatIdx >= sc.beats.length) {
      // Scene finished, check for next scene or end of chapter
      if (currentSceneIdx + 1 < ch.scenes.length) {
        playScene(currentSceneIdx + 1);
      } else {
        finishChapter(ch);
      }
      return;
    }

    const beat = sc.beats[currentBeatIdx];
    seenBeats.add(beat.id);
    saveSnapshot();

    // Check custom beat handlers
    if (beatHandlers.has(beat.type)) {
      beatHandlers.get(beat.type)(beat, () => advance());
      return;
    }

    renderBeat(beat);
  }

  function renderBeat(beat) {
    // 1. Apply Stage Changes
    if (beat.stage) {
      applyStagePlan(beat.stage);
    }

    // 2. Play Audio cues
    if (beat.stage && beat.stage.sfx) {
      playSfx(beat.stage.sfx);
    }
    if (beat.stage && beat.stage.ambience !== undefined) {
      playAmbience(beat.stage.ambience);
    }

    // 3. Stop previous voice
    stopVoice();

    // 4. Handle Beat Types
    if (beat.type === 'puzzle') {
      launchPuzzle(beat.puzzleKey, beat.onFail);
      return;
    }

    if (beat.type === 'cast') {
      advance();
      return;
    }

    // Line or Narration
    dom.textboxContainer.classList.remove('vno-hidden');
    if (beat.type === 'line') {
      const char = beat.speaker ? gameData.characters[beat.speaker] : null;
      const displayName = getLocalizedCharacterName(beat, beat.speakerLabel);
      dom.speakerName.textContent = displayName;
      dom.namebox.classList.remove('vno-hidden');
      if (char && char.color) {
        dom.speakerName.style.color = char.color;
      }
    } else {
      dom.namebox.classList.add('vno-hidden');
    }

    // Play Voice if present
    playVoiceForBeat(beat.id);

    // Render dialogue text
    const rawText = getLocalizedBeatText(beat.id, beat.text);
    const htmlText = formatBeatHtml(rawText);
    startTypewriter(htmlText);

    // Save structured entry to dialogue history so it re-localizes when language switches
    dialogueHistory.push({
      beatId: beat.id,
      type: beat.type,
      speaker: beat.speaker || null,
      speakerAliasKey: beat.speakerAliasKey || null,
      speakerLabel: beat.speakerLabel || '',
      fallbackText: beat.text || ''
    });
  }

  function applyStagePlan(stage) {
    if (!stage) return;

    // Hides
    if (stage.hides) {
      stage.hides.forEach(charKey => {
        clearSlotByChar(charKey);
      });
    }

    // Shows
    if (stage.shows) {
      stage.shows.forEach(item => {
        const slotEl = item.slot === 'left' ? dom.slotLeft : item.slot === 'right' ? dom.slotRight : dom.slotCenter;
        clearSlotByChar(item.charKey, slotEl);
        const char = gameData.characters[item.charKey];

        const spritePath = char && char.sprites ? (char.sprites[item.expression] || char.sprites['neutral'] || Object.values(char.sprites)[0]) : null;
        if (spritePath) {
          slotEl.innerHTML = '<img class="vno-sprite-img" data-char="' + item.charKey + '" src="' + spritePath + '" alt="' + item.charKey + '">';
          if (slotEl.setAttribute) slotEl.setAttribute('data-char', item.charKey);
        } else {
          const existingChar = getSlotCharKey(slotEl);
          if (existingChar && existingChar !== item.charKey) {
            slotEl.innerHTML = '';
            if (slotEl.setAttribute) slotEl.setAttribute('data-char', '');
          }
        }
      });
    }

    // CG / Insert
    if (stage.cg === null) {
      dom.cgLayer.classList.add('vno-hidden');
      dom.insertCard.classList.add('vno-hidden');
    } else if (stage.cg) {
      const cg = gameData.cgs[stage.cg];
      if (cg) {
        dom.cgLayer.classList.remove('vno-hidden');
        if (cg.display === 'insert') {
          dom.cgOverlay.style.backgroundImage = 'none';
          dom.insertImg.src = cg.path;
          dom.insertCard.classList.remove('vno-hidden');
        } else {
          dom.insertCard.classList.add('vno-hidden');
          dom.cgOverlay.classList.remove('vno-hidden');
          dom.cgOverlay.style.backgroundImage = 'url("' + cg.path + '")';
        }
      }
    }
  }

  function getSlotCharKey(slot) {
    if (!slot) return null;
    const img = slot.querySelector ? slot.querySelector('img') : null;
    if (img) {
      const dc = img.getAttribute ? img.getAttribute('data-char') : null;
      if (dc) return dc;
      if (img.alt) return img.alt;
    }
    const dcAttr = slot.getAttribute ? slot.getAttribute('data-char') : null;
    if (dcAttr) return dcAttr;
    const m = /data-char="([^"]+)"/.exec(slot.innerHTML || '') || /alt="([^"]+)"/.exec(slot.innerHTML || '');
    return m ? m[1] : null;
  }

  function clearSlotByChar(charKey, exceptSlot) {
    [dom.slotLeft, dom.slotCenter, dom.slotRight].forEach(slot => {
      if (!slot || slot === exceptSlot) return;
      const img = slot.querySelector ? slot.querySelector('img') : null;
      const imgChar = img ? ((img.getAttribute && img.getAttribute('data-char')) || img.alt) : getSlotCharKey(slot);
      if (imgChar === charKey) {
        slot.innerHTML = '';
        if (slot.setAttribute) slot.setAttribute('data-char', '');
      }
    });
  }

  function startTypewriter(htmlText) {
    clearInterval(typewriterTimer);
    dom.indicator.classList.add('vno-hidden');
    currentFullText = htmlText;

    if (settings.textSpeed >= 100) {
      dom.dialogueText.innerHTML = htmlText;
      isTyping = false;
      dom.indicator.classList.remove('vno-hidden');
      return;
    }

    isTyping = true;
    let charIdx = 0;
    const plain = htmlText.replace(/<[^>]+>/g, '');
    const interval = Math.max(10, 100 - settings.textSpeed);

    typewriterTimer = setInterval(() => {
      charIdx++;
      if (charIdx >= plain.length) {
        completeTypewriter();
      } else {
        dom.dialogueText.textContent = plain.slice(0, charIdx);
      }
    }, interval);
  }

  function completeTypewriter() {
    clearInterval(typewriterTimer);
    isTyping = false;
    dom.dialogueText.innerHTML = currentFullText;
    dom.indicator.classList.remove('vno-hidden');
  }

  function finishChapter(ch) {
    if (ch.choices && ch.choices.length > 0) {
      showChoices(ch.choices);
    } else if (ch.ending) {
      showEnding(ch.ending.message);
    } else if (ch.nextChapterLabel) {
      const nextN = parseInt(ch.nextChapterLabel.replace('ch_', ''), 10);
      const nextIdx = gameData.chapters.findIndex(c => c.number === nextN);
      if (nextIdx >= 0) playChapter(nextIdx);
      else returnToMainMenu();
    } else {
      returnToMainMenu();
    }
  }

  function showChoices(choices) {
    activeChoices = choices;
    dom.choiceContainer.innerHTML = '';
    const ch = gameData.chapters[currentChapterIdx];
    const chNum = ch ? ch.number : (currentChapterIdx + 1);
    choices.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'vno-choice-btn';
      const key = chNum + ':' + i;
      btn.textContent = (currentEdition && currentEdition.choices && currentEdition.choices[key]) || c.text;
      btn.addEventListener('click', () => {
        activeChoices = null;
        dom.choiceOverlay.classList.add('vno-hidden');
        const targetIdx = gameData.chapters.findIndex(item => item.number === c.targetChapterId);
        if (targetIdx >= 0) playChapter(targetIdx);
        else returnToMainMenu();
      });
      dom.choiceContainer.appendChild(btn);
    });
    dom.choiceOverlay.classList.remove('vno-hidden');
  }

  function showEnding(msg) {
    activeEndingMsg = msg || '';
    const ch = gameData.chapters[currentChapterIdx];
    const localizedEnding =
      (currentEdition && currentEdition.endings && ch && currentEdition.endings[ch.number]) ||
      msg ||
      ui('The End', 'The End');
    dom.endingCardText.textContent = localizedEnding;
    dom.endingCard.classList.remove('vno-hidden');
  }

  // Puzzles Logic
  function launchPuzzle(puzzleKey, onFail) {
    const pz = gameData.puzzles[puzzleKey];
    if (!pz) {
      advance();
      return;
    }

    if (puzzleHandlers.has(pz.kind)) {
      puzzleHandlers.get(pz.kind)(pz, onFail, onPuzzleSolved, onPuzzleFailed);
      return;
    }

    const BUILTIN_PUZZLE_KINDS = ['murdle', 'logic', 'knights', 'testimony', 'quiz'];
    // Default Murdle / Logic / Knights / Testimony / Quiz handler
    renderBuiltinPuzzle(pz, onFail);
  }

  function renderBuiltinPuzzle(pz, onFail, existingStruckClues) {
    const struckClues = existingStruckClues || (activePuzzle && activePuzzle.pz === pz ? activePuzzle.struckClues : new Set());
    activePuzzle = { pz: pz, onFail: onFail, struckClues: struckClues };

    const edPz = currentEdition && currentEdition.puzzles ? currentEdition.puzzles[pz.key] : null;
    const pzText = Object.assign({}, pz.text || {}, (edPz && edPz.text) || {});
    const pzNames = Object.assign({}, pz.names || {}, (edPz && edPz.names) || {});

    dom.puzzleTitle.textContent = (edPz && edPz.title) || pz.title || (pz.kind.toUpperCase() + ' PUZZLE');
    dom.puzzleOverlay.classList.remove('vno-hidden');
    dom.puzzleOverlay.setAttribute('data-puzzle-kind', pz.kind);
    dom.puzzleBody.innerHTML = '';

    const leftCol = document.createElement('div');
    leftCol.className = 'vno-puzzle-left-col';
    const rightCol = document.createElement('div');
    rightCol.className = 'vno-puzzle-right-col';

    // Intro / Murder note if present
    const introNote = pzText.murder || pzText.intro;
    if (introNote) {
      const introEl = document.createElement('div');
      introEl.className = 'vno-puzzle-intro';
      introEl.textContent = introNote;
      leftCol.appendChild(introEl);
    }

    // Clues / Statements / Evidence / Questions
    const cluesTitle = document.createElement('h3');
    cluesTitle.textContent = ui('Clues', 'Clues');
    leftCol.appendChild(cluesTitle);

    const addClueRow = (clueId, fallbackText) => {
      const item = document.createElement('div');
      item.className = 'vno-clue-item' + (struckClues.has(clueId) ? ' struck' : '');
      item.setAttribute('data-clue-id', clueId);
      item.textContent = pzText[clueId] || fallbackText || ('Clue ' + clueId);
      item.onclick = () => {
        if (struckClues.has(clueId)) {
          struckClues.delete(clueId);
          item.classList.remove('struck');
        } else {
          struckClues.add(clueId);
          item.classList.add('struck');
        }
      };
      leftCol.appendChild(item);
    };

    if (pz.data && Array.isArray(pz.data.clues)) {
      pz.data.clues.forEach(c => addClueRow(c.id, c.text));
    } else if (pz.data && Array.isArray(pz.data.statements)) {
      pz.data.statements.forEach(s => {
        const speakerName = s.speaker ? (pzNames[s.speaker] || s.speaker) : '';
        const stmtText = pzText[s.id] || s.text || ('Statement ' + s.id);
        addClueRow(s.id, speakerName ? (speakerName + ': ' + stmtText) : stmtText);
      });
    } else if (pz.data && Array.isArray(pz.data.questions)) {
      pz.data.questions.forEach(q => addClueRow(q.id, q.prompt || q.text));
    } else {
      Object.keys(pzText).forEach(k => {
        if (k !== 'murder' && k !== 'intro') {
          addClueRow(k, pzText[k]);
        }
      });
    }

    if (pz.data && Array.isArray(pz.data.evidence)) {
      pz.data.evidence.forEach(ev => {
        const evName = pzNames[ev.id] || ev.id;
        const evText = pzText[ev.id] || '';
        addClueRow(ev.id, evName && evText ? (evName + ' — ' + evText) : (evText || evName));
      });
    }

    // Render item names summary in right column so localized names are visible
    const nameKeys = Object.keys(pzNames);
    if (nameKeys.length > 0) {
      const namesList = document.createElement('div');
      namesList.className = 'vno-puzzle-names';
      nameKeys.forEach(k => {
        const badge = document.createElement('span');
        badge.className = 'vno-puzzle-name-item';
        badge.setAttribute('data-item-id', k);
        badge.textContent = pzNames[k];
        namesList.appendChild(badge);
      });
      rightCol.appendChild(namesList);
    }

    // Accuse / Submit Button
    const btnSubmit = document.createElement('button');
    btnSubmit.id = 'vno-puzzle-btn-submit';
    btnSubmit.className = 'vno-button';
    btnSubmit.style.marginTop = '20px';
    btnSubmit.textContent = pz.kind === 'murdle' ? ui('Accuse', 'Accuse') : ui('Submit', 'Submit');
    btnSubmit.onclick = () => {
      onPuzzleSolved();
    };
    leftCol.appendChild(btnSubmit);

    // Header buttons
    const btnHint = document.getElementById('vno-puzzle-btn-hint');
    if (btnHint) btnHint.textContent = ui('Hint', 'Hint');

    // Give Up button
    const btnGiveUp = document.getElementById('vno-puzzle-btn-giveup');
    if (btnGiveUp) {
      btnGiveUp.textContent = ui('Give Up', 'Give Up');
      btnGiveUp.onclick = () => {
        onPuzzleFailed(onFail);
      };
    }

    dom.puzzleBody.appendChild(leftCol);
    dom.puzzleBody.appendChild(rightCol);
  }

  function onPuzzleSolved() {
    activePuzzle = null;
    dom.puzzleOverlay.classList.add('vno-hidden');
    advance();
  }

  function onPuzzleFailed(onFail) {
    activePuzzle = null;
    dom.puzzleOverlay.classList.add('vno-hidden');
    if (onFail && onFail.mode === 'chapter' && onFail.to) {
      const targetIdx = gameData.chapters.findIndex(c => c.number === onFail.to);
      if (targetIdx >= 0) playChapter(targetIdx);
      else advance();
    } else {
      advance();
    }
  }

  // Audio Helpers
  function playMusic(trackId, loopStart) {
    if (!gameData.audio || !gameData.audio.music || !gameData.audio.music[trackId]) return;
    const item = gameData.audio.music[trackId];
    if (typeof loopStart !== 'number' && typeof item.loopStartSec === 'number') {
      loopStart = item.loopStartSec;
    }
    if (dom.audioMusic.src.includes(item.path) && !dom.audioMusic.paused) return;

    dom.audioMusic.src = item.path;
    dom.audioMusic.currentTime = 0;
    dom.audioMusic.ontimeupdate = null;
    dom.audioMusic.onended = null;

    if (typeof loopStart === 'number' && loopStart > 0) {
      dom.audioMusic.loop = false;
      dom.audioMusic.ontimeupdate = () => {
        if (dom.audioMusic.currentTime >= dom.audioMusic.duration - 0.25) {
          dom.audioMusic.currentTime = loopStart;
        }
      };
      dom.audioMusic.onended = () => {
        dom.audioMusic.currentTime = loopStart;
        dom.audioMusic.play().catch(() => {});
      };
    } else {
      dom.audioMusic.loop = true;
    }

    dom.audioMusic.play().catch(() => {});
  }

  function stopMusic() {
    if (!dom.audioMusic) return;
    dom.audioMusic.pause();
    dom.audioMusic.currentTime = 0;
    dom.audioMusic.src = '';
    dom.audioMusic.ontimeupdate = null;
    dom.audioMusic.onended = null;
  }

  function playAmbience(ambKey) {
    if (!ambKey || !gameData.audio || !gameData.audio.ambience || !gameData.audio.ambience[ambKey]) {
      dom.audioAmbience.pause();
      return;
    }
    const rel = gameData.audio.ambience[ambKey];
    dom.audioAmbience.src = rel;
    dom.audioAmbience.play().catch(() => {});
  }

  function playSfx(sfxKey) {
    if (!sfxKey || !gameData.audio || !gameData.audio.sfx || !gameData.audio.sfx[sfxKey]) return;
    const rel = gameData.audio.sfx[sfxKey];
    dom.audioSfx.src = rel;
    dom.audioSfx.play().catch(() => {});
  }

  function playVoiceForBeat(beatId) {
    if (!currentEdition || !currentEdition.voice || !currentEdition.voice[beatId]) return;
    const rel = currentEdition.voice[beatId];
    dom.audioVoice.src = rel;
    dom.audioVoice.play().catch(() => {});
  }

  function stopVoice() {
    if (dom.audioVoice) dom.audioVoice.pause();
  }

  // Localization & Formatting Helpers
  function formatBeatHtml(text) {
    if (!text) return '';
    let s = String(text)
      .replace(/\\[\\[/g, '[')
      .replace(/\\{\\{/g, '{')
      .replace(/\\\\"/g, '"')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    s = s.replace(/\\{b\\}([\\s\\S]*?)\\{\\/b\\}/g, '<strong>$1</strong>');
    s = s.replace(/\\{i\\}([\\s\\S]*?)\\{\\/i\\}/g, '<em>$1</em>');
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    s = s.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
    s = s.replace(/\\r?\\n/g, '<br/>');
    return s;
  }

  function getLocalizedChapterTitle(chIdx, def) {
    const n = gameData.chapters[chIdx]?.number;
    return (currentEdition && currentEdition.chapterTitles && currentEdition.chapterTitles[n]) || def;
  }

  function getLocalizedCharacterName(beatOrKey, def) {
    const names = currentEdition && currentEdition.characterNames ? currentEdition.characterNames : null;
    if (beatOrKey && typeof beatOrKey === 'object') {
      if (beatOrKey.speakerAliasKey && names && names[beatOrKey.speakerAliasKey]) {
        return names[beatOrKey.speakerAliasKey];
      }
      if (beatOrKey.speaker && names && names[beatOrKey.speaker]) {
        return names[beatOrKey.speaker];
      }
      return def || beatOrKey.speakerLabel || beatOrKey.speaker || '';
    }
    const charKey = beatOrKey;
    return (names && charKey && names[charKey]) || def || charKey || '';
  }

  function getLocalizedBeatText(beatId, def) {
    return (currentEdition && currentEdition.beats && currentEdition.beats[beatId]) || def || '';
  }

  function updateCurrentDialogueDisplay() {
    if (!gameData) return;
    const ch = gameData.chapters[currentChapterIdx];
    if (!ch) return;
    const sc = ch.scenes[currentSceneIdx];
    if (!sc || currentBeatIdx < 0 || !sc.beats[currentBeatIdx]) return;
    const b = sc.beats[currentBeatIdx];
    if (b.type !== 'line' && b.type !== 'narration') return;

    const htmlText = formatBeatHtml(getLocalizedBeatText(b.id, b.text));
    if (isTyping) {
      clearInterval(typewriterTimer);
      isTyping = false;
      if (dom.indicator) dom.indicator.classList.remove('vno-hidden');
    }
    currentFullText = htmlText;
    dom.dialogueText.innerHTML = htmlText;
    if (b.type === 'line') {
      dom.speakerName.textContent = getLocalizedCharacterName(b, b.speakerLabel);
    }
  }

  // Snapshots & Rollback
  function saveSnapshot() {
    stateHistory.push({
      chIdx: currentChapterIdx,
      scIdx: currentSceneIdx,
      beatIdx: currentBeatIdx,
      slotLeft: dom.slotLeft.innerHTML,
      slotCenter: dom.slotCenter.innerHTML,
      slotRight: dom.slotRight.innerHTML,
      bg: dom.bgImage.style.backgroundImage,
      cgLayer: dom.cgLayer.classList.contains('vno-hidden'),
      cgOverlay: dom.cgOverlay.style.backgroundImage,
      insertImg: dom.insertImg.src
    });
    if (stateHistory.length > 50) stateHistory.shift();
  }

  function rollback() {
    if (stateHistory.length <= 1) return;
    stateHistory.pop(); // discard current
    const snap = stateHistory.pop();
    currentChapterIdx = snap.chIdx;
    currentSceneIdx = snap.scIdx;
    currentBeatIdx = snap.beatIdx - 1;

    dom.slotLeft.innerHTML = snap.slotLeft;
    dom.slotCenter.innerHTML = snap.slotCenter;
    dom.slotRight.innerHTML = snap.slotRight;
    dom.bgImage.style.backgroundImage = snap.bg;
    if (snap.cgLayer) dom.cgLayer.classList.add('vno-hidden');
    else dom.cgLayer.classList.remove('vno-hidden');
    dom.cgOverlay.style.backgroundImage = snap.cgOverlay;
    dom.insertImg.src = snap.insertImg;

    advance();
  }

  // Save / Load Storage
  function quickSave() {
    saveToSlot('quick');
  }

  function quickLoad() {
    loadFromSlot('quick');
  }

  function saveToSlot(slotId) {
    const key = (gameData.saveDir || 'vno-save') + '_' + slotId;
    const ch = gameData.chapters[currentChapterIdx];
    const data = {
      timestamp: Date.now(),
      title: ch ? ch.title : '',
      text: dom.dialogueText.textContent.slice(0, 60),
      chIdx: currentChapterIdx,
      scIdx: currentSceneIdx,
      beatIdx: currentBeatIdx,
      lang: currentLang
    };
    localStorage.setItem(key, JSON.stringify(data));
  }

  function loadFromSlot(slotId) {
    const key = (gameData.saveDir || 'vno-save') + '_' + slotId;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const data = JSON.parse(raw);
    closeAllScreens();
    currentChapterIdx = data.chIdx;
    currentSceneIdx = data.scIdx;
    currentBeatIdx = data.beatIdx - 1;
    if (data.lang) switchLanguage(data.lang);
    advance();
  }

  function openSaveScreen(isSaving) {
    activeSaveScreen = { page: 1, isSaving: isSaving };
    document.getElementById('vno-save-screen-title').textContent = isSaving ? ui('Save', 'Save Game') : ui('Load', 'Load Game');
    renderSaveSlots(1, isSaving);
    openScreen(dom.screenSave);
  }

  function renderSaveSlots(page, isSaving) {
    activeSaveScreen = { page: page, isSaving: isSaving };
    const grid = document.getElementById('vno-save-slots-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const emptyLabel = ui('empty slot', 'Empty');
    for (let i = 1; i <= 6; i++) {
      const slotId = page + '_' + i;
      const key = (gameData.saveDir || 'vno-save') + '_' + slotId;
      const raw = localStorage.getItem(key);
      const card = document.createElement('div');
      card.className = 'vno-slot-card';
      if (raw) {
        const item = JSON.parse(raw);
        card.innerHTML = '<h4>Slot ' + slotId + '</h4><p>' + new Date(item.timestamp).toLocaleString() + '</p><p>' + item.text + '...</p>';
      } else {
        card.innerHTML = '<h4>Slot ' + slotId + '</h4><p>' + emptyLabel + '</p>';
      }
      card.onclick = () => {
        if (isSaving) {
          saveToSlot(slotId);
          renderSaveSlots(page, isSaving);
        } else {
          loadFromSlot(slotId);
        }
      };
      grid.appendChild(card);
    }
  }

  function renderHistoryList() {
    const list = document.getElementById('vno-history-list');
    if (!list) return;
    list.innerHTML = '';
    if (dialogueHistory.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vno-history-empty';
      empty.textContent = ui('The dialogue history is empty.', 'The dialogue history is empty.');
      list.appendChild(empty);
      return;
    }
    dialogueHistory.forEach(d => {
      const row = document.createElement('div');
      row.className = 'vno-history-item';
      row.style.marginBottom = '16px';
      const htmlText = d.beatId ? formatBeatHtml(getLocalizedBeatText(d.beatId, d.fallbackText)) : (d.text || '');
      const speakerName = d.type === 'line'
        ? getLocalizedCharacterName(d, d.speakerLabel)
        : (d.speaker && !d.beatId ? d.speaker : '');
      if (speakerName) row.innerHTML = '<strong>' + speakerName + ':</strong> ' + htmlText;
      else row.innerHTML = htmlText;
      list.appendChild(row);
    });
  }

  function openHistoryScreen() {
    renderHistoryList();
    openScreen(dom.screenHistory);
  }

  function openScreen(screenEl) {
    closeAllScreens();
    screenEl.classList.remove('vno-hidden');
  }

  function closeAllScreens() {
    [dom.screenSave, dom.screenPrefs, dom.screenHistory, dom.screenAbout].forEach(s => {
      if (s) s.classList.add('vno-hidden');
    });
  }

  function loadSettings() {
    const raw = localStorage.getItem('vno_settings');
    if (raw) {
      try { Object.assign(settings, JSON.parse(raw)); } catch(e) {}
    }
  }

  function saveSettings() {
    localStorage.setItem('vno_settings', JSON.stringify(settings));
  }

  // Public Extensibility Engine API
  window.VNOEngine = {
    registerPuzzleKind: function(kind, handler) {
      puzzleHandlers.set(kind, handler);
    },
    registerBeatHandler: function(type, handler) {
      beatHandlers.set(type, handler);
    },
    getState: function() {
      return {
        chapterIdx: currentChapterIdx,
        sceneIdx: currentSceneIdx,
        beatIdx: currentBeatIdx,
        lang: currentLang
      };
    },
    getLanguages: function() {
      return gameData && gameData.languages ? gameData.languages : [];
    },
    switchLanguage: switchLanguage,
    loadGameData: loadGameData,
    advance: advance
  };

  document.addEventListener('DOMContentLoaded', init);
})();
`
}

export interface WritePlayerBundleResult {
  files: string[]
}

/**
 * Writes the player runtime bundle files (index.html, player.css, player.js, game-data.json, game-data.js)
 * into outputDir.
 */
export async function writePlayerBundle(outputDir: string, gameData: GameData, extraThemeCss = ''): Promise<WritePlayerBundleResult> {
  fs.mkdirSync(outputDir, { recursive: true })
  const written: string[] = []

  // 1. game-data.json
  const jsonContent = JSON.stringify(gameData, null, 2)
  fs.writeFileSync(path.join(outputDir, 'game-data.json'), jsonContent, 'utf8')
  written.push('game-data.json')

  // 2. game-data.js (for zero CORS file:// support)
  const jsDataContent = `window.VNO_GAME_DATA = ${jsonContent};\n`
  fs.writeFileSync(path.join(outputDir, 'game-data.js'), jsDataContent, 'utf8')
  written.push('game-data.js')

  // 3. Theme CSS if available
  const themeCss = extraThemeCss || renderThemeCss(gameData.theme, {
    text: gameData.theme.fonts?.text || 'DejaVuSans.ttf',
    name: gameData.theme.fonts?.name || gameData.theme.fonts?.text || 'DejaVuSans.ttf',
    interface: gameData.theme.fonts?.interface || gameData.theme.fonts?.text || 'DejaVuSans.ttf',
    bold: gameData.theme.fonts?.bold || null
  })

  // 4. player.css
  const cssContent = themeCss + '\n\n' + generatePlayerCss(gameData)
  fs.writeFileSync(path.join(outputDir, 'player.css'), cssContent, 'utf8')
  written.push('player.css')

  // 5. player.js
  const jsContent = generatePlayerJs()
  fs.writeFileSync(path.join(outputDir, 'player.js'), jsContent, 'utf8')
  written.push('player.js')

  // 6. index.html
  const htmlContent = generateIndexHtml(gameData)
  fs.writeFileSync(path.join(outputDir, 'index.html'), htmlContent, 'utf8')
  written.push('index.html')

  return { files: written }
}

/**
 * Renders the full player runtime strings: HTML, CSS, and JS.
 */
export function renderPlayerRuntime(gameData?: GameData): { html: string; css: string; js: string } {
  const dummyData: GameData =
    gameData ??
    ({
      title: 'Visual Novel',
      slug: 'vn',
      saveDir: 'vno-save',
      primaryLang: 'en',
      languages: [{ code: 'en', name: 'English', nativeName: 'English', rtl: false }],
      rtlLangs: [],
      resolution: { w: 1920, h: 1080 },
      theme: {
        name: 'classic-dark',
        label: 'Classic Dark',
        description: '',
        light: false,
        pixel: false,
        colors: { accent: '#3b82f6', background: '#000', text: '#fff', idle: '#aaa', hover: '#fff', selected: '#3b82f6', insensitive: '#555', muted: '#6b7280' },
        fonts: { text: 'DejaVuSans.ttf' },
        sizes: { text: 32, name: 36, interface: 30, label: 30, title: 40, choice: 30 },
        transitions: { show: 0.2, fade: 0.5, dissolve: 0.2 },
        textbox: { color: '#000', opacity: 0.8, borderColor: null, radius: 0 },
        namebox: { color: '#000', opacity: 0.8, radius: 0, textColor: null },
        choice: { color: '#222', borderColor: null, radius: 4 },
        frames: {}
      },
      characters: {},
      backgrounds: {},
      cgs: {},
      audio: { music: {}, sfx: {}, ambience: {} },
      chapters: [],
      editions: {},
      puzzles: {}
    } as unknown as GameData)
  return {
    html: generateIndexHtml(dummyData),
    css: generatePlayerCss(dummyData),
    js: generatePlayerJs()
  }
}
