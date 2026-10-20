import { expect, test } from 'vitest'
import { createEmptyAttempt, getInterval, TIME_BOUNDARIES } from './timeline'
import type { BoundarySnapshot, ProcessState, ReferenceCell } from './types'

test('40 consecutive intervals have 41 boundaries including the terminal time', () => {
  const intervals = Array.from({ length: 40 }, (_, index) => getInterval(index))

  expect(intervals[0]).toEqual({ start: 0, end: 1 })
  expect(intervals[39]).toEqual({ start: 39, end: 40 })
  expect(intervals.map(({ start }) => start).concat(40)).toEqual(TIME_BOUNDARIES)
  expect(new Set(TIME_BOUNDARIES).size).toBe(41)
  expect(Object.isFrozen(TIME_BOUNDARIES)).toBe(true)
})

test.each([-1, 40, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects invalid editable cell index %s',
  (index) => {
    expect(() => getInterval(index)).toThrow(RangeError)
  },
)

test('new attempts use independent rows of explicit unanswered cells', () => {
  const attempt = createEmptyAttempt()
  const nextAttempt = createEmptyAttempt()

  expect(attempt.cpu).toHaveLength(40)
  expect(attempt.io).toHaveLength(40)
  expect(attempt.cpu).toEqual(Array(40).fill(null))
  expect(attempt.io).toEqual(Array(40).fill(null))
  expect(attempt.cpu).not.toBe(attempt.io)
  expect(nextAttempt.cpu).not.toBe(attempt.cpu)
  expect(attempt.cpu).not.toContain('idle')
})

test('terminal history can record completion at 40 without another assignment', () => {
  const completed: ProcessState = {
    processId: 'P1',
    status: 'completed',
    completedAt: 40,
  }
  const boundary: BoundarySnapshot = {
    kind: 'terminal',
    time: 40,
    processes: [completed],
    readyQueue: [],
    ioQueue: [],
    events: [
      { type: 'cpu-burst-completed', processId: 'P1', burst: 2 },
      { type: 'process-completed', processId: 'P1' },
    ],
  }

  expect(boundary.processes[0]).toEqual(completed)
  expect(boundary).not.toHaveProperty('cpu')
  expect(boundary).not.toHaveProperty('io')
})

// These rejected assignments are checked by TypeScript, not just the test runner.
// @ts-expect-error Reference answers cannot contain unanswered cells.
const unansweredReference: ReferenceCell = null
// @ts-expect-error A ready process must retain its current CPU burst and work.
const incompleteReadyState: ProcessState = { processId: 'P1', status: 'ready' }
void unansweredReference
void incompleteReadyState
