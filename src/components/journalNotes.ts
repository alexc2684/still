export type JournalNoteParts = { beforeNote?: string | null; duringNote?: string | null; afterNote?: string | null }

/** Preserve legacy stage notes while making the unified afterNote representation idempotent. */
export function combineJournalNotes(notes: JournalNoteParts) {
  if (!notes.beforeNote && !notes.duringNote) return notes.afterNote ?? ''
  return [['Before', notes.beforeNote], ['During', notes.duringNote], ['After', notes.afterNote]].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join('\n\n')
}
