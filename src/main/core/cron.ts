import { CronExpressionParser } from 'cron-parser'

export function nextCronTime(expression: string, timeZone: string, from: number = Date.now()): number {
  const interval = CronExpressionParser.parse(expression, {
    currentDate: new Date(from),
    tz: timeZone
  })
  return interval.next().toDate().getTime()
}

export function isValidCron(expression: string, timeZone: string): boolean {
  try {
    CronExpressionParser.parse(expression, { currentDate: new Date(), tz: timeZone })
    return true
  } catch {
    return false
  }
}

export function cronForDailyTime(time: string): string {
  const [hoursRaw, minutesRaw] = time.split(':')
  const hours = Math.min(Math.max(Number(hoursRaw) || 0, 0), 23)
  const minutes = Math.min(Math.max(Number(minutesRaw) || 0, 0), 59)
  return `${minutes} ${hours} * * *`
}
