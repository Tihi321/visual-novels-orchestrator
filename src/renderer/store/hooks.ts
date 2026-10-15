import { useMemo } from 'react'
import { useStore } from 'zustand'
import { vnStore } from './store'
import type { AgentView, VnStore } from './store'

export function useVn<T>(selector: (s: VnStore) => T): T {
  return useStore(vnStore, selector)
}

/** All agents in engine order. */
export function useAgentList(): AgentView[] {
  const agents = useVn((s) => s.agents)
  const order = useVn((s) => s.agentOrder)
  return useMemo(() => order.map((id) => agents[id]).filter((a): a is AgentView => !!a), [agents, order])
}
