'use client'

import { useId, useRef } from 'react'
import './timer-dial.css'

export type TimerDialProps = {
  durationMinutes: number
  remainingSeconds: number
  disabled?: boolean
  onDurationChange?: (minutes: number) => void
  phaseLabel?: string
  running?: boolean
}

const RADIUS = 126
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
function clampMinutes(value: number) { return Math.max(1, Math.min(120, Math.round(value))) }
function formatTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` }

export default function TimerDial({ durationMinutes, remainingSeconds, disabled = false, onDurationChange, phaseLabel, running = false }: TimerDialProps) {
  const dialRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<{ id: number; angle: number; exactMinutes: number } | null>(null)
  const inputId = useId()
  const total = durationMinutes * 60
  const selectedSeconds = durationMinutes * 60
  const firstProgress = running ? Math.max(0, Math.min(1, remainingSeconds / total)) : Math.min(1, selectedSeconds / 3600)
  const secondProgress = running ? 0 : Math.max(0, Math.min(1, (selectedSeconds - 3600) / 3600))
  const setFromPointer = (event: React.PointerEvent) => {
    if (!dialRef.current || disabled || !onDurationChange) return
    const bounds = dialRef.current.getBoundingClientRect(), x = event.clientX - (bounds.left + bounds.width / 2), y = event.clientY - (bounds.top + bounds.height / 2)
    let angle = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360
    const drag = pointerRef.current!
    while (angle - drag.angle > 180) angle -= 360
    while (drag.angle - angle > 180) angle += 360
    const exactMinutes = Math.max(1, Math.min(120, drag.exactMinutes + (angle - drag.angle) / 6))
    pointerRef.current = { id: event.pointerId, angle, exactMinutes }
    onDurationChange!(clampMinutes(exactMinutes))
  }
  const beginPointer = (event: React.PointerEvent) => {
    if (disabled || !onDurationChange || !dialRef.current) return
    const bounds = dialRef.current.getBoundingClientRect(), scaleX = bounds.width / 280, scaleY = bounds.height / 280, x = (event.clientX - (bounds.left + bounds.width / 2)) / scaleX, y = (event.clientY - (bounds.top + bounds.height / 2)) / scaleY
    if (Math.hypot(x, y) < RADIUS - 24) return
    dialRef.current.setPointerCapture(event.pointerId)
    const raw = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360
    const currentLapMinutes = durationMinutes > 60 ? durationMinutes - 60 : durationMinutes
    const current = currentLapMinutes * 6
    const thumbX = RADIUS * Math.sin(current * Math.PI / 180), thumbY = -RADIUS * Math.cos(current * Math.PI / 180)
    const onThumb = Math.hypot(x - thumbX, y - thumbY) < 22
    const lapBase = durationMinutes > 60 ? 60 : 0
    const clickedLapMinutes = raw === 0 ? 60 : raw / 6
    const exactMinutes = onThumb ? durationMinutes : lapBase + clickedLapMinutes
    pointerRef.current = { id: event.pointerId, angle: onThumb ? current : raw, exactMinutes }
    onDurationChange(clampMinutes(exactMinutes))
  }
  const movePointer = (event: React.PointerEvent) => { if (pointerRef.current?.id === event.pointerId) setFromPointer(event) }
  const endPointer = (event: React.PointerEvent) => { if (pointerRef.current?.id === event.pointerId) pointerRef.current = null }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); onDurationChange!(clampMinutes(durationMinutes + 1)) }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); onDurationChange!(clampMinutes(durationMinutes - 1)) }
    if (event.key === 'Home') { event.preventDefault(); onDurationChange!(1) }
    if (event.key === 'End') { event.preventDefault(); onDurationChange!(120) }
  }
  const angle = (durationMinutes > 60 ? durationMinutes - 60 : durationMinutes) * 6
  const thumbX = 140 + RADIUS * Math.sin(angle * Math.PI / 180), thumbY = 140 - RADIUS * Math.cos(angle * Math.PI / 180)
  const interactive = Boolean(onDurationChange) && !disabled
  return <div className={`timer-dial ${interactive ? 'is-interactive' : ''}`} ref={dialRef} onPointerDown={beginPointer} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer}>
    <svg viewBox="0 0 280 280" aria-hidden="true"><circle className="timer-dial-track" cx="140" cy="140" r={RADIUS} /><circle key={running ? 'countdown' : 'duration'} className="timer-dial-progress" cx="140" cy="140" r={RADIUS} strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - firstProgress)} />{!running && durationMinutes > 60 && <circle className="timer-dial-progress timer-dial-progress-second" cx="140" cy="140" r="116" strokeDasharray={2 * Math.PI * 116} strokeDashoffset={2 * Math.PI * 116 * (1 - secondProgress)} />}{onDurationChange && <circle className="timer-dial-thumb" cx={thumbX} cy={thumbY} r="7" />}</svg>
    <div className="timer-dial-center"><strong>{formatTime(remainingSeconds)}</strong><span>{phaseLabel || (remainingSeconds === 0 ? 'well done' : 'remaining')}</span>{interactive && durationMinutes > 60 && <small>second revolution</small>}</div>
    {onDurationChange && <div className="timer-dial-duration"><label htmlFor={inputId}>Duration</label><input id={inputId} type="number" min="1" max="120" step="1" value={durationMinutes} disabled={disabled} onChange={event => onDurationChange(clampMinutes(Number(event.target.value) || 1))} onPointerDown={event => event.stopPropagation()} /></div>}
    {interactive && <div className="timer-dial-slider" role="slider" tabIndex={0} aria-label="Duration in minutes" aria-valuemin={1} aria-valuemax={120} aria-valuenow={durationMinutes} aria-valuetext={`${durationMinutes} minutes`} onKeyDown={onKeyDown} />}
  </div>
}
