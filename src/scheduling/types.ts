/** Runtime validation restricts IDs to P followed by a positive safe integer. */
export type ProcessId = `P${number}`

export interface ProcessInput {
  readonly id: ProcessId
  readonly arrival: number
  readonly cpu1: number
  readonly io: number
  readonly cpu2: number
  /** Smaller numbers mean higher priority. Required for priority scheduling. */
  readonly priority?: number
}

export type SchedulingSettings =
  | { readonly algorithm: 'fcfs-course' }
  | { readonly algorithm: 'sjf' }
  | { readonly algorithm: 'srtf' }
  | { readonly algorithm: 'round-robin'; readonly quantum: number }
  | {
      readonly algorithm: 'priority'
      readonly mode: 'preemptive' | 'non-preemptive'
    }

export const RULES_VERSION = 1
export const GENERATOR_VERSION = 1
export const TIMELINE_LENGTH = 40

export interface Problem {
  /** Unsigned 32-bit seed; the actual workload is retained as well. */
  readonly seed: number
  readonly rulesVersion: typeof RULES_VERSION
  readonly generatorVersion: typeof GENERATOR_VERSION
  readonly settings: SchedulingSettings
  readonly processes: readonly ProcessInput[]
}

export type CpuBurst = 1 | 2
export type Resource = 'cpu' | 'io'
export type ReferenceCell = ProcessId | 'idle'
/** null means unanswered, not intentionally idle. */
export type AttemptCell = ReferenceCell | null

/** Both rows contain exactly TIMELINE_LENGTH cells, indexed by interval start. */
export interface TimelineRows<Cell> {
  readonly cpu: readonly Cell[]
  readonly io: readonly Cell[]
}

export type Attempt = TimelineRows<AttemptCell>
export type ReferenceTimeline = TimelineRows<ReferenceCell>

/** Array position preserves FIFO order independently of selection tie-breaks. */
export interface ReadyQueueEntry {
  readonly processId: ProcessId
  readonly enteredAt: number
}

export interface IoQueueEntry {
  readonly processId: ProcessId
  readonly requestedAt: number
}

/** Only the active CPU burst is compared; future CPU and I/O are excluded. */
export interface CpuCandidate extends ReadyQueueEntry {
  readonly burst: CpuBurst
  readonly remainingCpu: number
  readonly priority?: number
}

export type ProcessState = { readonly processId: ProcessId } & (
  | { readonly status: 'not-arrived' }
  | {
      readonly status: 'ready'
      readonly burst: CpuBurst
      readonly remainingCpu: number
      readonly enteredAt: number
    }
  | {
      readonly status: 'running'
      readonly burst: CpuBurst
      readonly remainingCpu: number
      /** Retain the last ready entry for dispatch and preemption explanations. */
      readonly enteredAt: number
      /** null for policies without time slices. */
      readonly quantumRemaining: number | null
    }
  | {
      readonly status: 'waiting-for-io'
      readonly remainingIo: number
      readonly requestedAt: number
    }
  | {
      readonly status: 'performing-io'
      readonly remainingIo: number
      readonly startedAt: number
    }
  | { readonly status: 'completed'; readonly completedAt: number }
)

/** Events belong to their containing boundary; array order is execution order. */
export type SimulationEvent =
  | {
      readonly type: 'cpu-burst-completed'
      readonly processId: ProcessId
      readonly burst: CpuBurst
    }
  | { readonly type: 'io-requested'; readonly processId: ProcessId }
  | { readonly type: 'io-completed'; readonly processId: ProcessId }
  | { readonly type: 'process-completed'; readonly processId: ProcessId }
  | {
      readonly type: 'became-ready'
      readonly processId: ProcessId
      readonly reason: 'arrival' | 'io-completion'
    }
  | {
      readonly type: 'quantum-expired'
      readonly processId: ProcessId
      readonly remainingCpu: number
    }
  | {
      readonly type: 'cpu-preempted'
      readonly reason: 'shorter-remaining-burst' | 'higher-priority'
      readonly running: CpuCandidate
      readonly challenger: CpuCandidate
    }
  | { readonly type: 'io-started'; readonly processId: ProcessId }
  | {
      readonly type: 'cpu-dispatched'
      readonly processId: ProcessId
      readonly burst: CpuBurst
      /** Capture the comparison inputs so feedback does not reconstruct them. */
      readonly candidates: readonly CpuCandidate[]
      readonly criterion:
        | 'original-launch-order'
        | 'shortest-current-burst'
        | 'shortest-remaining-burst'
        | 'highest-priority'
        | 'fifo-ready-queue'
    }
  | {
      readonly type: 'resource-idle'
      readonly resource: Resource
      readonly reason: 'no-ready-process' | 'no-io-request' | 'all-completed'
    }

interface BoundaryState {
  readonly time: number
  readonly processes: readonly ProcessState[]
  readonly readyQueue: readonly ReadyQueueEntry[]
  readonly ioQueue: readonly IoQueueEntry[]
  readonly events: readonly SimulationEvent[]
}

export type BoundarySnapshot =
  | (BoundaryState & {
      /** Times 0–39: after dispatch, immediately before executing [time,time+1). */
      readonly kind: 'interval-start'
      readonly cpu: ReferenceCell
      readonly io: ReferenceCell
    })
  | (BoundaryState & {
      /** Time 40: finish boundary bookkeeping, but never dispatch or execute. */
      readonly kind: 'terminal'
      readonly time: typeof TIMELINE_LENGTH
    })

/** Future simulator output: 40 cells per row and boundaries 0 through 40. */
export type SimulationResult = {
  readonly timeline: ReferenceTimeline
  readonly boundaries: readonly BoundarySnapshot[]
} & (
  | { readonly status: 'complete'; readonly completionTime: number }
  | { readonly status: 'limit-reached'; readonly completionTime: null }
)
