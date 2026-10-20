import { TIMELINE_LENGTH, type Attempt, type AttemptCell } from './types'

export const TIME_BOUNDARIES: readonly number[] = Object.freeze(
  Array.from({ length: TIMELINE_LENGTH + 1 }, (_, time) => time),
)

/** Cell zero represents [0,1); boundary 40 is not a 41st editable cell. */
export function getInterval(cellIndex: number): { start: number; end: number } {
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= TIMELINE_LENGTH) {
    throw new RangeError(`Cell index must be an integer from 0 to ${TIMELINE_LENGTH - 1}.`)
  }
  return { start: cellIndex, end: cellIndex + 1 }
}

export function createEmptyAttempt(): Attempt {
  return {
    cpu: Array<AttemptCell>(TIMELINE_LENGTH).fill(null),
    io: Array<AttemptCell>(TIMELINE_LENGTH).fill(null),
  }
}
