import type { ProcessId } from './types'

export function isProcessId(value: unknown): value is ProcessId {
  if (typeof value !== 'string') return false

  const number = Number(value.slice(1))
  return (
    Number.isSafeInteger(number) &&
    number > 0 &&
    value === `P${number}`
  )
}
