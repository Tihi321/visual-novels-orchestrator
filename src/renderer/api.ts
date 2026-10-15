import type { Command, EngineEvent, ProjectSettingsPatch, VnStudioApi } from '../shared/protocol'
import { fileUrl, type HostApi, type PickKind } from './hostApi'
import { vnStore } from './store/store'

/** The host (Electron preload) API. Every extra is optional, so a plain browser page can still load. */
export type RendererApi = VnStudioApi & Partial<HostApi>

declare global {
  interface Window {
    vnstudio: RendererApi
  }
}

export function sendCommand(command: Command): void {
  window.vnstudio.send(command)
}

/** Changes a project's settings: shown at once, and sent to the engine (which merges the patch into project.md). */
export function updateSettings(slug: string, patch: ProjectSettingsPatch): void {
  vnStore.getState().patchSettingsLocal(slug, patch)
  sendCommand({ type: 'updateProjectSettings', slug, patch })
}

/**
 * Connects the store to the engine: events are queued and applied every 50 ms,
 * so a burst of streamed tokens causes one render, not hundreds.
 * Returns a function that disconnects.
 */
export function connectEngine(api: RendererApi = window.vnstudio): () => void {
  let queue: EngineEvent[] = []
  let scheduled = false
  const flush = () => {
    scheduled = false
    const batch = queue
    queue = []
    vnStore.getState().applyEvents(batch)
  }
  const off = api.on((event) => {
    queue.push(event)
    if (!scheduled) {
      scheduled = true
      setTimeout(flush, 50)
    }
  })
  api.send({ type: 'snapshot' })
  return () => {
    off()
    queue = []
  }
}

/** URL of a project image under `projects/<slug>/assets/` or `preview/`. */
export function projectFileUrl(rel: string): string {
  return fileUrl(rel)
}

export async function openFolder(rel: string): Promise<boolean> {
  return (await window.vnstudio.openFolder?.(rel)) ?? false
}

/** Folder picker (desktop app only; null when cancelled or in a plain browser). */
export async function pickFolder(title?: string): Promise<string | null> {
  return (await window.vnstudio.pickFolder?.(title)) ?? null
}

export async function pickFile(title?: string, kind: PickKind = 'any'): Promise<string | null> {
  return (await window.vnstudio.pickFile?.(title, kind)) ?? null
}

/** The end of a file in the data folder (a project's log.md), or null. */
export async function tailText(rel: string, bytes: number): Promise<string | null> {
  const r = await window.vnstudio.tailFile?.(rel, -bytes)
  return r ? r.text : null
}

export async function readText(rel: string): Promise<string | null> {
  return (await window.vnstudio.readFile?.(rel)) ?? null
}

export async function getStartWithWindows(): Promise<boolean | null> {
  return (await window.vnstudio.getStartWithWindows?.()) ?? null
}

export async function setStartWithWindows(on: boolean): Promise<boolean | null> {
  return (await window.vnstudio.setStartWithWindows?.(on)) ?? null
}
