import { isProcessId } from '../scheduling/process-id'
import { createEmptyAttempt, getInterval } from '../scheduling/timeline'
import type { Attempt, AttemptCell, Resource } from '../scheduling/types'

export const ATTEMPT_HISTORY_LIMIT = 100

export interface AttemptHistory {
  readonly past: readonly Attempt[]
  readonly present: Attempt
  readonly future: readonly Attempt[]
}

export type AttemptAction =
  | {
      readonly type: 'paint'
      readonly resource: Resource
      readonly start: number
      readonly end: number
      readonly value: AttemptCell
    }
  | { readonly type: 'fill-idle' }
  | { readonly type: 'clear' }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'reset' }

export function createAttemptHistory(): AttemptHistory {
  return { past: [], present: createEmptyAttempt(), future: [] }
}

function saveEdit(state: AttemptHistory, present: Attempt): AttemptHistory {
  const changed = (['cpu', 'io'] as const).some((resource) =>
    present[resource].some((cell, index) => cell !== state.present[resource][index]),
  )
  if (!changed) return state

  return {
    past: [...state.past, state.present].slice(-ATTEMPT_HISTORY_LIMIT),
    present,
    future: [],
  }
}

/** One paint action represents a completed click or drag, including both endpoints. */
export function attemptReducer(state: AttemptHistory, action: AttemptAction): AttemptHistory {
  switch (action.type) {
    case 'paint': {
      getInterval(action.start)
      getInterval(action.end)
      if (action.resource !== 'cpu' && action.resource !== 'io') {
        throw new TypeError('Paint resource must be cpu or io.')
      }
      if (action.value !== null && action.value !== 'idle' && !isProcessId(action.value)) {
        throw new TypeError('Paint value must be a process ID, idle, or null.')
      }

      const start = Math.min(action.start, action.end)
      const end = Math.max(action.start, action.end)
      const row = state.present[action.resource].slice()
      row.fill(action.value, start, end + 1)
      return saveEdit(state, { ...state.present, [action.resource]: row })
    }
    case 'fill-idle':
      return saveEdit(state, {
        cpu: state.present.cpu.map((cell) => cell ?? 'idle'),
        io: state.present.io.map((cell) => cell ?? 'idle'),
      })
    case 'clear':
      return saveEdit(state, createEmptyAttempt())
    case 'undo': {
      const previous = state.past.at(-1)
      if (!previous) return state
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
      }
    }
    case 'redo': {
      const next = state.future[0]
      if (!next) return state
      return {
        past: [...state.past, state.present].slice(-ATTEMPT_HISTORY_LIMIT),
        present: next,
        future: state.future.slice(1),
      }
    }
    case 'reset':
      return createAttemptHistory()
  }
}
