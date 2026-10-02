'use client'

import { useEffect, useRef, useState } from 'react'
import { combineJournalNotes, type JournalNoteParts } from './journalNotes'

type Result = JournalNoteParts & { id: string; date: string; seconds: number }
type Results = { results: Result[]; hasMore: boolean }

export default function ReflectionSearch() {
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')
  const [results, setResults] = useState<Results | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  useEffect(() => () => { requestId.current += 1 }, [])

  function clear() {
    requestId.current += 1
    setQuery(''); setSearched(''); setResults(null); setError(''); setBusy(false)
  }

  async function search() {
    const id = ++requestId.current
    const term = query.trim()
    setBusy(true); setError(''); setResults(null); setSearched(term)
    try {
      const response = await fetch('/api/journal/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: term }), cache: 'no-store',
      })
      if (!response.ok) throw new Error('Search failed')
      const body: Results = await response.json()
      if (id === requestId.current) setResults(body)
    } catch {
      if (id === requestId.current) setError('Unable to search your reflections. Please try again.')
    } finally {
      if (id === requestId.current) setBusy(false)
    }
  }

  return <section className="reflection-search" aria-labelledby="reflection-search-heading">
    <h2 id="reflection-search-heading">Find a moment</h2>
    <p>Search your private reflections across every practice day.</p>
    <form role="search" onSubmit={event => { event.preventDefault(); void search() }}>
      <label htmlFor="reflection-query">Words you remember</label>
      <div className="reflection-search-controls">
        <input id="reflection-query" type="search" value={query} maxLength={200} required placeholder="Try sleep, gratitude, or a busy mind" onChange={event => setQuery(event.target.value)} />
        <button className="secondary-button" disabled={busy || !query.trim()}>Search</button>
        <button className="text-button" type="button" onClick={clear}>Clear</button>
      </div>
    </form>
    <div role="status" aria-live="polite">
      {busy && <p>Searching your reflections…</p>}
      {results && <p>{results.hasMore ? 'Showing the 50 most recent matches' : `${results.results.length} matching reflections`} for “{searched}”.{results.hasMore && ' Try more specific words to narrow your search.'}</p>}
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {results && results.results.length === 0 && <p>No reflections found. Try a different word or phrase.</p>}
    {results && <div className="reflection-search-results">{results.results.map(result => <article key={result.id} className="post">
      <h3>{new Date(`${result.date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</h3>
      <span>{Math.max(1, Math.round(result.seconds / 60))} minutes practiced</span>
      <p className="reflection-notes-block">{combineJournalNotes(result)}</p>
    </article>)}</div>}
  </section>
}
