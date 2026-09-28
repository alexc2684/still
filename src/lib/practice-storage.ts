'use client'

export function storageGet(key: string | null) {
  if (!key) return null
  try { return localStorage.getItem(key) } catch { return null }
}
export function storageSet(key: string | null, value: string) {
  if (!key) return
  try { localStorage.setItem(key, value) } catch { /* storage is optional */ }
}
export function storageRemove(key: string | null) {
  if (!key) return
  try { localStorage.removeItem(key) } catch { /* storage is optional */ }
}
