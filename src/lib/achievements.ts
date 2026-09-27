export type Achievement = { kind: string; label: string }

export type AchievementSession = {
  id: string
  userId?: string
  completedAt: string | Date
  localDate: string
  seconds: number
  goalDays?: number | null
  goalMinutes?: number | null
}

const HOUR_MILESTONES = [1, 10, 25, 50, 100, 250, 500]

function previousDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

function orderedPrefix(history: AchievementSession[], targetId: string): AchievementSession[] | null {
  const ordered = [...history].sort((a, b) => {
    const time = new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime()
    return time || a.id.localeCompare(b.id)
  })
  const targetIndex = ordered.findIndex((session) => session.id === targetId)
  return targetIndex < 0 ? null : ordered.slice(0, targetIndex + 1)
}

/** Compute achievements earned by exactly one completed session. */
export function achievementsFor(history: AchievementSession[], targetId: string): Achievement[] {
  const prefix = orderedPrefix(history, targetId)
  if (!prefix) return []
  const current = prefix[prefix.length - 1]
  const before = prefix.slice(0, -1)
  const achievements: Achievement[] = []

  if (prefix.length === 1) achievements.push({ kind: 'first_sit', label: 'First sit on Still' })

  const dates = new Set(prefix.map((session) => session.localDate))
  let streak = 1
  let date = current.localDate
  while (dates.has(previousDate(date))) {
    streak += 1
    date = previousDate(date)
  }
  achievements.push({ kind: 'streak', label: `${streak} day streak` })

  const beforeSeconds = before.reduce((total, session) => total + Number(session.seconds), 0)
  const currentSeconds = beforeSeconds + Number(current.seconds)
  for (const hours of HOUR_MILESTONES) {
    const threshold = hours * 60 * 60
    if (beforeSeconds < threshold && currentSeconds >= threshold) {
      achievements.push({ kind: `${hours}_hours`, label: `${hours} ${hours === 1 ? 'hour' : 'hours'} practiced` })
    }
  }

  const goalDays = current.goalDays ?? null
  const goalMinutes = current.goalMinutes ?? null
  if (goalDays !== null || goalMinutes !== null) {
    const [year, month, day] = current.localDate.split('-').map(Number)
    const local = new Date(Date.UTC(year, month - 1, day))
    const mondayOffset = (local.getUTCDay() + 6) % 7
    local.setUTCDate(local.getUTCDate() - mondayOffset)
    const weekStart = local.toISOString().slice(0, 10)
    const inWeek = prefix.filter((session) => session.localDate >= weekStart && session.localDate <= current.localDate)
    const beforeWeek = before.filter((session) => session.localDate >= weekStart && session.localDate <= current.localDate)
    const daysNow = new Set(inWeek.map((session) => session.localDate)).size
    const daysBefore = new Set(beforeWeek.map((session) => session.localDate)).size
    const minutesNow = inWeek.reduce((total, session) => total + Number(session.seconds), 0) / 60
    const minutesBefore = beforeWeek.reduce((total, session) => total + Number(session.seconds), 0) / 60
    const daysCrossed = goalDays !== null && daysBefore < goalDays && daysNow >= goalDays
    const minutesCrossed = goalMinutes !== null && minutesBefore < goalMinutes && minutesNow >= goalMinutes

    if (goalDays !== null && goalMinutes !== null && daysNow >= goalDays && minutesNow >= goalMinutes && (daysCrossed || minutesCrossed)) {
      achievements.push({ kind: 'weekly_goal', label: 'Weekly goal reached' })
    } else {
      if (daysCrossed) achievements.push({ kind: 'days_goal', label: `${goalDays} day weekly goal` })
      if (minutesCrossed) achievements.push({ kind: 'minutes_goal', label: `${goalMinutes} minute weekly goal` })
    }
  }
  return achievements
}
