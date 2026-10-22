import type { PuzzleEntry } from '../../shared/puzzle'

/**
 * The task for the separate reader of the flavour check: the prose and the names only, never the structured clues (the reader must not see
 * what the clues mean, only what the words say), and the format of the answer. One per puzzle kind.
 */
export function readBackTask(p: Pick<PuzzleEntry, 'data'>, words: { names: Record<string, string>; text: Record<string, string> }): string {
  const d = p.data
  const names = `Names: ${Object.values(words.names).join('; ')}`
  if (d.kind === 'knights') {
    return [
      'Read these statements of a Knights and Knaves puzzle (knights always tell the truth, knaves always lie) and write each one back as structured data. Use only the names in the list; do not guess what is not said.',
      names,
      ...d.statements.map((s) => `${s.id}: ${words.text[s.id] ?? '(missing)'}`),
      'Answer with JSON: [{"id": "t1", "speaker": "<a name>", "claim": <claim>}] where a claim is one of: {"type": "knight" | "knave", "who": "<name>"} ("X is a knight"), {"type": "same" | "diff", "a": "<name>", "b": "<name>"} (same kind / different kinds), {"type": "some_knave" | "all_knight", "of": ["<name>", ...]} ("at least one of ... is a knave" / "all of ... are knights"), {"type": "exactly", "k": <number>, "of": [...]} ("exactly k of ... are knights"), {"type": "not", "c": <claim>}, {"type": "and" | "or", "a": <claim>, "b": <claim>}. "Of us" means every speaker: list every name.'
    ].join('\n')
  }
  const traits = Object.entries(d.descr ?? {}).filter(([it]) => d.clues.some((c) => (c.descr ?? []).includes(it)))
  return [
    'Read these clues of a logic puzzle and write each one back as structured data. Use only the names in the list; do not guess what is not said.',
    names,
    ...(traits.length ? [`Some clues point at an item by a trait. Who or what each trait is: ${traits.map(([it, desc]) => `${desc} = ${words.names[it]}`).join('; ')}. Answer with the name, not the trait.`] : []),
    ...d.clues.map((c) => `${c.id}: ${words.text[c.id] ?? '(missing)'}`),
    'Answer with JSON: [{"id": "c1", "type": "is" | "not" | "either", "a": "<a name>", "b": "<a name>" or ["<a name>", "<a name>"] for either}]. is: a and b go together. not: they do not. either: a goes with one of the two names in b.'
  ].join('\n')
}
