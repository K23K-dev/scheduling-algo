import { addMissingPriorities, generateProblem } from '../scheduling/generator'
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
  // Validate the original model before enrichment, so a malformed saved
  // priority or seed cannot be silently repaired by changing algorithms.
  const original = parseProblem(problem)
  if (!original.valid) {
    throw new TypeError(
      `Invalid practice problem: ${original.issues
        .map((issue) => `${issue.path || 'problem'}: ${issue.message}`)
        .join('; ')}`,
    )
  }

  // Validate settings independently of missing workload priorities. This valid
  // probe supports every policy; enrichment happens only after both inputs pass.
  const parsed = parseProblem({
    ...original.value,
    settings,
    processes: [{ id: 'P1', arrival: 0, cpu1: 1, io: 1, cpu2: 1, priority: 1 }],
  })
  if (!parsed.valid) {
    throw new TypeError(
      `Invalid practice settings: ${parsed.issues
        .map((issue) => `${issue.path || 'problem'}: ${issue.message}`)
        .join('; ')}`,
    )
  }

  const updated: Problem = {
    ...original.value,
    settings: parsed.value.settings,
    processes:
      parsed.value.settings.algorithm === 'priority'
        ? addMissingPriorities(original.value.seed, original.value.processes)
        : original.value.processes,
  }
  if (simulate(updated).status === 'complete') {
    return { problem: updated, replaced: false }
  }
  return { problem: generateProblem(replacementSeed, updated.settings), replaced: true }
}
