/** Parse API ISO/MySQL timestamps without treating empty or invalid dates as zero. */
function createdAtTime(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value !== 'string' || !value.trim()) return null

  const timestamp = value.trim()
  const parts = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i)
  if (!parts) return null

  const [, yearText, monthText, dayText, hourText = '0', minuteText = '0', secondText = '0'] = parts
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) return null

  // SQL timestamps use a space; ISO's T also parses consistently in browsers.
  const time = Date.parse(timestamp.replace(' ', 'T'))
  return Number.isFinite(time) ? time : null
}

/** Newest created_at first; ties and invalid/missing timestamps retain their input order. */
export function sortRecordsByCreatedAt(records = []) {
  if (!Array.isArray(records)) return []
  return records
    .map((record, index) => ({ record, index, time: createdAtTime(record?.created_at) }))
    .sort((a, b) => {
      if (a.time === null && b.time !== null) return 1
      if (a.time !== null && b.time === null) return -1
      if (a.time !== null && b.time !== null && a.time !== b.time) return b.time - a.time
      return a.index - b.index
    })
    .map(({ record }) => record)
}

/** Latest valid original created_at value, for groups containing multiple records. */
export function latestCreatedAt(records = []) {
  if (!Array.isArray(records)) return null
  let latest = null
  let latestTime = null
  for (const record of records) {
    const time = createdAtTime(record?.created_at)
    if (time !== null && (latestTime === null || time > latestTime)) {
      latest = record.created_at
      latestTime = time
    }
  }
  return latest
}
