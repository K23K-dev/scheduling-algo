import { generateProblem } from '../scheduling/generator'
import { simulate } from '../scheduling/simulator'
import type { Problem, SchedulingSettings } from '../scheduling/types'
import { parseProblem } from '../scheduling/validation'

/**
 * Keep the current workload when it fits under the new settings. The supplied
 * replacement seed is used only when a different worksheet is necessary.
 */
export function updateProblemSettings(
  problem: Problem,
  settings: SchedulingSettings,
  replacementSeed: number,
): { problem: Problem; replaced: boolean } {
  if (
    settings?.algorithm === 'sjf' ||
    settings?.algorithm === 'srtf' ||
    settings?.algorithm === 'priority'
  ) {
    throw new Error(
      `Unsupported scheduling algorithm: ${settings.algorithm}. Only course FCFS and round robin are implemented.`,
    )
  }

  const parsed = parseProblem({ ...problem, settings })
  if (!parsed.valid) {
    throw new TypeError(
      `Invalid practice settings: ${parsed.issues
        .map((issue) => `${issue.path || 'problem'}: ${issue.message}`)
        .join('; ')}`,
    )
  }

  if (simulate(parsed.value).status === 'complete') {
    return { problem: parsed.value, replaced: false }
  }
  return { problem: generateProblem(replacementSeed, settings), replaced: true }
}
