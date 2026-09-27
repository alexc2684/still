'use client'

let context: AudioContext | null = null
let bowlUntil = 0

function getContext() {
  if (typeof window === 'undefined') return null
  if (!context) {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (AudioContextClass) context = new AudioContextClass()
  }
  return context
}

/** Call from the same user gesture as the host action on iOS/Safari. */
export function unlockBowlAudio() {
  const ctx = getContext()
  if (!ctx) return
  void ctx.resume()
  try {
    const oscillator = ctx.createOscillator(), gain = ctx.createGain()
    gain.gain.value = 0.00001
    oscillator.connect(gain).connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime + 0.02)
  } catch { /* audio is optional */ }
}

/** Play one restrained singing-bowl strike. Calls are throttled while it rings. */
export function playBowl() {
  const ctx = getContext()
  if (!ctx) return
  const nowWall = typeof performance === 'undefined' ? Date.now() : performance.now()
  if (nowWall < bowlUntil) return
  bowlUntil = nowWall + 9000
  try {
    const now = ctx.currentTime, master = ctx.createGain()
    master.gain.value = 0.24; master.connect(ctx.destination)
    const modes = [[180, 0.42, 9], [487.8, 0.18, 7], [486.1, 0.13, 7], [972, 0.09, 5.8], [970.9, 0.065, 5.8], [1602, 0.035, 4.2]] as const
    modes.forEach(([frequency, amplitude, decay]) => {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain()
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, now)
      gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(amplitude, now + 0.045); gain.gain.exponentialRampToValueAtTime(0.0001, now + decay)
      oscillator.connect(gain).connect(master); oscillator.start(now); oscillator.stop(now + decay + 0.1)
    })
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.09), ctx.sampleRate), samples = buffer.getChannelData(0)
    for (let index = 0; index < samples.length; index += 1) samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length)
    const strike = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), strikeGain = ctx.createGain()
    strike.buffer = buffer; filter.type = 'lowpass'; filter.frequency.setValueAtTime(1800, now); strikeGain.gain.setValueAtTime(0.035, now); strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
    strike.connect(filter).connect(strikeGain).connect(master); strike.start(now)
  } catch { /* restrictive browsers can refuse audio */ }
}
