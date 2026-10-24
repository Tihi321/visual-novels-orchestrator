import type { StageSlotView } from '../../shared/protocol'
import type { VnBeat, VnScene } from '../../shared/vn'

export const STAGE_SLOTS: readonly StageSlotView[] = ['left', 'center', 'right']

export interface AccumulatedStage {
  slots: Partial<Record<StageSlotView, { charKey: string; expression: string }>>
  cg: string | null
  activeSpeaker: string | null
}

export function computeStageAtBeat(
  scene: VnScene,
  cuesCasts: Record<string, Record<string, StageSlotView>> | undefined,
  beatIdx: number
): AccumulatedStage {
  const slots: Partial<Record<StageSlotView, { charKey: string; expression: string }>> = {}
  const charSlot = new Map<string, StageSlotView>()
  const charExpr = new Map<string, string>()
  let cg: string | null = null

  const limit = Math.min(beatIdx, scene.beats.length - 1)
  for (let i = 0; i <= limit; i++) {
    const b = scene.beats[i]!
    if (b.type === 'cast') {
      const seen = new Set<string>()
      const deduped = b.cast.filter((c) => {
        if (seen.has(c.charKey)) return false
        seen.add(c.charKey)
        return true
      })
      const activeKeys = deduped.map((c) => c.charKey).slice(0, 3)
      const activeSet = new Set(activeKeys)

      // Clear characters no longer in cast
      for (const [k, slot] of charSlot.entries()) {
        if (!activeSet.has(k)) {
          if (slots[slot]?.charKey === k) delete slots[slot]
          charSlot.delete(k)
        }
      }

      // Slot allocation
      const raw = cuesCasts?.[b.id] ?? {}
      const usedSlots = new Set<StageSlotView>()
      const assigned = new Map<string, StageSlotView>()

      for (const k of activeKeys) {
        const pref = raw[k]
        if (pref && !usedSlots.has(pref)) {
          assigned.set(k, pref)
          usedSlots.add(pref)
        }
      }
      for (const k of activeKeys) {
        if (!assigned.has(k)) {
          const free = STAGE_SLOTS.find((s) => !usedSlots.has(s)) ?? 'center'
          assigned.set(k, free)
          usedSlots.add(free)
        }
      }

      for (const k of STAGE_SLOTS) delete slots[k]
      charSlot.clear()

      for (const [k, slot] of assigned.entries()) {
        charSlot.set(k, slot)
        const expr = charExpr.get(k) ?? 'neutral'
        slots[slot] = { charKey: k, expression: expr }
      }
    } else if (b.type === 'line') {
      if (b.speakerKey) {
        charExpr.set(b.speakerKey, b.expression)
        const slot = charSlot.get(b.speakerKey)
        if (slot) {
          slots[slot] = { charKey: b.speakerKey, expression: b.expression }
        }
      }
    }

    if (b.image !== undefined) {
      cg = b.image
    }
  }

  const curBeat = scene.beats[limit]
  const activeSpeaker = curBeat?.type === 'line' ? curBeat.speakerKey : null
  return { slots, cg, activeSpeaker }
}