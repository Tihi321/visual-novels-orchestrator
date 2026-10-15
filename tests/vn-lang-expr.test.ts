import { describe, expect, it } from 'vitest'
import { mapExpression } from '../src/engine/vn/expressions'
import { detectLanguage } from '../src/engine/vn/lang'

describe('detectLanguage', () => {
  it('detects English', () => {
    const r = detectLanguage('The sun is warm and the flowers nod in the breeze. It was a nice day, and she said that you were late.')
    expect(r.lang).toBe('en')
    expect(r.confidence).toBeGreaterThan(0.5)
  })
  it('detects Croatian', () => {
    const r = detectLanguage('Sunce je toplo i cvijeće se njiše na vjetru. Što je to? Nije kasno, ali ona se nije vratila kući.')
    expect(r.lang).toBe('hr')
    expect(r.confidence).toBeGreaterThan(0.5)
  })
  it('detects Croatian by diacritics alone', () => {
    expect(detectLanguage('Čaša šljiva žuta đurđica ćup').lang).toBe('hr')
  })
  it('has no confidence for empty or tiny text', () => {
    expect(detectLanguage('').confidence).toBe(0)
    expect(detectLanguage('the').confidence).toBeLessThan(0.2)
  })
})

describe('mapExpression', () => {
  const cases: [string, string][] = [
    ['grinning', 'happy'],
    ['giggling', 'happy'],
    ['crying', 'sad'],
    ['annoyed', 'angry'],
    ['startled', 'surprised'],
    ['gasping', 'surprised'],
    ['worried', 'worried'],
    ['terrified', 'scared'],
    ['curious', 'thinking'],
    ['ljut', 'angry'],
    ['ljuta', 'angry'],
    ['iznenađen', 'surprised'],
    ['iznenađena', 'surprised'],
    ['zabrinut', 'worried'],
    ['uplašen', 'scared'],
    ['zamišljen', 'thinking'],
    ['tužna', 'sad'],
    ['nasmijan', 'happy'],
    ['out of breath, grinning', 'happy']
  ]
  it.each(cases)('maps %s to %s', (raw, expected) => {
    expect(mapExpression(raw).expression).toBe(expected)
    expect(mapExpression(raw).known).toBe(true)
  })
  it('keeps the raw word only when it is not the canonical one', () => {
    expect(mapExpression('happy')).toEqual({ expression: 'happy', known: true })
    expect(mapExpression('grinning').rawExpression).toBe('grinning')
  })
  it('falls back to neutral and keeps the raw text', () => {
    expect(mapExpression('singing')).toEqual({ expression: 'neutral', rawExpression: 'singing', known: false })
  })
})
