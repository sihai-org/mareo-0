import assert from 'node:assert/strict'
import test from 'node:test'
import { dayStamp, dayStampDaysAgo, startOfDay, startOfDayDaysAgo } from '../src/clock.js'

test('the day turns over at midnight Beijing time, not at UTC midnight', () => {
  // 00:30 on 15 September in Beijing is still 16:30 on the 14th in UTC.
  const afterMidnight = new Date('2026-09-14T16:30:00Z')
  assert.equal(dayStamp(afterMidnight), '2026-09-15')
  assert.equal(startOfDay(afterMidnight), '2026-09-14T16:00:00.000Z')

  // One minute earlier is still the previous Beijing day.
  const beforeMidnight = new Date('2026-09-14T15:59:00Z')
  assert.equal(dayStamp(beforeMidnight), '2026-09-14')
  assert.equal(startOfDay(beforeMidnight), '2026-09-13T16:00:00.000Z')
})

test('day stamps are zero-padded and independent of the host timezone', () => {
  assert.equal(dayStamp(new Date('2026-01-05T02:00:00Z')), '2026-01-05')
  assert.equal(dayStamp(new Date('2026-12-31T20:00:00Z')), '2027-01-01')
})

test('a 7-day window covers today plus the previous six days', () => {
  const now = new Date('2026-09-14T16:30:00Z') // 15 September in Beijing
  assert.equal(dayStampDaysAgo(0, now), '2026-09-15')
  assert.equal(dayStampDaysAgo(6, now), '2026-09-09')
  assert.equal(startOfDayDaysAgo(6, now), '2026-09-08T16:00:00.000Z')
})
