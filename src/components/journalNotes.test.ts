import { describe, expect, it } from 'vitest'
import { combineJournalNotes } from './journalNotes'

describe('combineJournalNotes', () => {
  it('preserves legacy stage labels and is idempotent after migration', () => {
    const legacy = combineJournalNotes({ beforeNote: 'arrived', duringNote: 'settled', afterNote: 'clear' })
    expect(legacy).toBe('Before: arrived\n\nDuring: settled\n\nAfter: clear')
    expect(combineJournalNotes({ afterNote: legacy })).toBe(legacy)
  })
})
