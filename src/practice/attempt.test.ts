import { describe, expect, test } from 'vitest'
import type { Attempt, AttemptCell } from '../scheduling/types'
import {
  ATTEMPT_HISTORY_LIMIT,
  attemptReducer,
  createAttemptHistory,
  type AttemptAction,
  type AttemptHistory,
} from './attempt'

function paint(
  state: AttemptHistory,
  start: number,
  end: number,
  value: AttemptCell = 'P1',
  resource: 'cpu' | 'io' = 'cpu',
): AttemptHistory {
  return attemptReducer(state, { type: 'paint', resource, start, end, value })
}

function freezeHistory(state: AttemptHistory): AttemptHistory {
  for (const attempt of [...state.past, state.present, ...state.future]) {
    Object.freeze(attempt.cpu)
    Object.freeze(attempt.io)
    Object.freeze(attempt)
  }
  Object.freeze(state.past)
  Object.freeze(state.future)
  return Object.freeze(state)
}

test('new workspaces have independent, unanswered 40-cell rows and empty history', () => {
  const first = createAttemptHistory()
  const second = createAttemptHistory()

  expect(first).toEqual({
    past: [],
    present: { cpu: Array(40).fill(null), io: Array(40).fill(null) },
    future: [],
  })
  expect(first.present.cpu).not.toBe(first.present.io)
  expect(first.present.cpu).not.toBe(second.present.cpu)
  expect(first.present.io).not.toBe(second.present.io)
})

test('a forward drag paints both endpoints on only its chosen row', () => {
  const empty = freezeHistory(createAttemptHistory())
  const painted = paint(empty, 2, 5, 'P2')

  expect(painted.present.cpu).toEqual([
    ...Array(2).fill(null), ...Array(4).fill('P2'), ...Array(34).fill(null),
  ])
  expect(painted.present.io).toBe(empty.present.io)
  expect(painted.present.cpu).not.toBe(empty.present.cpu)
  expect(empty.present.cpu).toEqual(Array(40).fill(null))
  expect(painted.past).toEqual([empty.present])
  expect(painted.future).toEqual([])
})

test('a reverse drag includes the first and last worksheet cells', () => {
  const painted = paint(createAttemptHistory(), 39, 0, 'P10', 'io')

  expect(painted.present.io).toEqual(Array(40).fill('P10'))
  expect(painted.present.cpu).toEqual(Array(40).fill(null))
  expect(painted.past).toHaveLength(1)
})

test('a click edits one cell and erasing makes it unanswered rather than idle', () => {
  const empty = createAttemptHistory()
  const assigned = paint(empty, 39, 39, 'P1')
  const idle = paint(assigned, 39, 39, 'idle')
  const erased = paint(idle, 39, 39, null)

  expect(assigned.present.cpu.slice(38)).toEqual([null, 'P1'])
  expect(idle.present.cpu.slice(38)).toEqual([null, 'idle'])
  expect(erased.present).toEqual(empty.present)
  expect(erased.past).toHaveLength(3)
})

test('editing accepts structurally valid assignments without grading scheduling decisions', () => {
  const cpu = paint(createAttemptHistory(), 0, 39, 'P900')
  const both = paint(cpu, 0, 39, 'P900', 'io')

  expect(both.present.cpu).toEqual(Array(40).fill('P900'))
  expect(both.present.io).toEqual(Array(40).fill('P900'))
})

test('undo and redo group a whole drag into one action and traverse both rows', () => {
  const initial = createAttemptHistory()
  const cpu = paint(initial, 0, 7, 'P1')
  const both = paint(cpu, 8, 12, 'P2', 'io')
  const undoIo = attemptReducer(both, { type: 'undo' })
  const undoCpu = attemptReducer(undoIo, { type: 'undo' })
  const redoCpu = attemptReducer(undoCpu, { type: 'redo' })
  const redoIo = attemptReducer(redoCpu, { type: 'redo' })

  expect(undoIo.present).toBe(cpu.present)
  expect(undoCpu.present).toBe(initial.present)
  expect(undoCpu.future).toEqual([cpu.present, both.present])
  expect(redoCpu.present).toBe(cpu.present)
  expect(redoIo).toEqual(both)
  expect(attemptReducer(undoCpu, { type: 'undo' })).toBe(undoCpu)
  expect(attemptReducer(redoIo, { type: 'redo' })).toBe(redoIo)
})

test('a new changed edit after undo drops the abandoned redo branch', () => {
  const first = paint(createAttemptHistory(), 0, 3)
  const second = paint(first, 4, 8, 'P2')
  const undone = attemptReducer(second, { type: 'undo' })
  const replacement = paint(undone, 9, 10, 'P3', 'io')

  expect(replacement.future).toEqual([])
  expect(replacement.past).toEqual(first.past.concat(first.present))
  expect(replacement.present.cpu.slice(4, 9)).toEqual(Array(5).fill(null))
  expect(attemptReducer(replacement, { type: 'redo' })).toBe(replacement)
})

describe('no-op edits preserve history and redo', () => {
  test('repainting an already matching range', () => {
    const first = paint(createAttemptHistory(), 0, 5)
    const undone = attemptReducer(paint(first, 8, 9), { type: 'undo' })

    expect(paint(undone, 4, 1)).toBe(undone)
    expect(attemptReducer(undone, { type: 'redo' }).present.cpu[9]).toBe('P1')
  })

  test('erasing or clearing an empty worksheet', () => {
    const empty = createAttemptHistory()
    const undone = attemptReducer(paint(empty, 0, 5), { type: 'undo' })

    expect(paint(undone, 3, 4, null)).toBe(undone)
    expect(attemptReducer(undone, { type: 'clear' })).toBe(undone)
  })

  test('filling idle when every cell already has an answer', () => {
    const filled = attemptReducer(createAttemptHistory(), { type: 'fill-idle' })
    const undone = attemptReducer(paint(filled, 0, 5), { type: 'undo' })

    expect(attemptReducer(undone, { type: 'fill-idle' })).toBe(undone)
  })
})

test('fill idle preserves assignments, fills both rows, and can be undone in one step', () => {
  const partial = paint(paint(createAttemptHistory(), 0, 3), 7, 8, 'P2', 'io')
  const filled = attemptReducer(freezeHistory(partial), { type: 'fill-idle' })

  expect(filled.present.cpu).toEqual([...Array(4).fill('P1'), ...Array(36).fill('idle')])
  expect(filled.present.io).toEqual([
    ...Array(7).fill('idle'), 'P2', 'P2', ...Array(31).fill('idle'),
  ])
  expect(filled.past).toHaveLength(partial.past.length + 1)
  expect(attemptReducer(filled, { type: 'undo' }).present).toBe(partial.present)
})

test('clear erases both rows in one undoable edit', () => {
  const partial = paint(paint(createAttemptHistory(), 0, 3), 7, 8, 'idle', 'io')
  const cleared = attemptReducer(freezeHistory(partial), { type: 'clear' })

  expect(cleared.present).toEqual(createAttemptHistory().present)
  expect(cleared.past).toHaveLength(partial.past.length + 1)
  expect(attemptReducer(cleared, { type: 'undo' }).present).toBe(partial.present)
  expect(cleared.present.cpu).not.toBe(cleared.present.io)
})

test('reset starts a detached blank worksheet with no way back into a previous problem', () => {
  const first = paint(createAttemptHistory(), 0, 3)
  const undone = attemptReducer(paint(first, 8, 9), { type: 'undo' })
  const reset = attemptReducer(freezeHistory(undone), { type: 'reset' })

  expect(reset).toEqual(createAttemptHistory())
  expect(reset.present.cpu).not.toBe(undone.present.cpu)
  expect(reset.present.io).not.toBe(undone.present.io)
  expect(attemptReducer(reset, { type: 'undo' })).toBe(reset)
  expect(attemptReducer(reset, { type: 'redo' })).toBe(reset)
  expect(attemptReducer(reset, { type: 'reset' }).present).not.toBe(reset.present)
})

test('history retains only the latest 100 meaningful edits through undo and redo', () => {
  let state = createAttemptHistory()
  const attempts: Attempt[] = [state.present]
  for (let edit = 0; edit < ATTEMPT_HISTORY_LIMIT + 5; edit += 1) {
    state = paint(state, 0, 0, edit % 2 === 0 ? 'P1' : 'P2')
    attempts.push(state.present)
    state = paint(state, 0, 0, edit % 2 === 0 ? 'P1' : 'P2')
  }

  expect(state.past).toHaveLength(ATTEMPT_HISTORY_LIMIT)
  expect(state.past).toEqual(attempts.slice(5, -1))
  const newest = state.present

  for (let undo = 0; undo < ATTEMPT_HISTORY_LIMIT; undo += 1) {
    state = attemptReducer(state, { type: 'undo' })
  }
  expect(state.present).toBe(attempts[5])
  expect(state.past).toEqual([])
  expect(state.future).toHaveLength(ATTEMPT_HISTORY_LIMIT)
  expect(attemptReducer(state, { type: 'undo' })).toBe(state)

  for (let redo = 0; redo < ATTEMPT_HISTORY_LIMIT; redo += 1) {
    state = attemptReducer(state, { type: 'redo' })
  }
  expect(state.present).toBe(newest)
  expect(state.past).toHaveLength(ATTEMPT_HISTORY_LIMIT)
  expect(state.future).toEqual([])
})

test('editing after undo cannot change any retained past or future snapshots', () => {
  const initial = createAttemptHistory()
  const first = paint(initial, 0, 3)
  const second = paint(first, 0, 3, 'P2')
  const undone = freezeHistory(attemptReducer(second, { type: 'undo' }))
  const recorded = structuredClone(undone)
  const branch = paint(undone, 2, 5, 'P3')

  expect(undone).toEqual(recorded)
  expect(initial.present.cpu).toEqual(Array(40).fill(null))
  expect(first.present.cpu.slice(0, 6)).toEqual(['P1', 'P1', 'P1', 'P1', null, null])
  expect(second.present.cpu.slice(0, 4)).toEqual(Array(4).fill('P2'))
  expect(branch.present.cpu.slice(0, 6)).toEqual(['P1', 'P1', 'P3', 'P3', 'P3', 'P3'])
  expect(branch.present.cpu).not.toBe(first.present.cpu)
  expect(branch.present.cpu).not.toBe(second.present.cpu)
})

test.each([-1, 40, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects invalid range endpoint %s without modifying history',
  (endpoint) => {
    const state = freezeHistory(createAttemptHistory())
    expect(() => paint(state, endpoint, 3)).toThrow(RangeError)
    expect(() => paint(state, 3, endpoint)).toThrow(RangeError)
    expect(state.past).toEqual([])
  },
)

test.each(['P0', 'P01', 'P1\n', 'P-1', 'process', undefined, 1])(
  'rejects malformed assignment %s',
  (value) => {
    expect(() => attemptReducer(createAttemptHistory(), {
      type: 'paint', resource: 'cpu', start: 0, end: 0, value,
    } as AttemptAction)).toThrow(TypeError)
  },
)

test('rejects a malformed resource without creating another timeline row', () => {
  expect(() => attemptReducer(createAttemptHistory(), {
    type: 'paint', resource: 'disk', start: 0, end: 0, value: 'P1',
  } as unknown as AttemptAction)).toThrow(TypeError)
})
