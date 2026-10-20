import {
  compareLaunchOrder,
  compareProcessIds,
  compareReadyEntries,
  getBoundaryPhases,
  shouldPreempt,
  shouldRequeueAfterQuantum,
} from './rules'
import {
  TIMELINE_LENGTH,
  type BoundarySnapshot,
  type CpuCandidate,
  type IoQueueEntry,
  type Problem,
  type ProcessInput,
  type ProcessState,
  type ReadyQueueEntry,
  type ReferenceCell,
  type SchedulingSettings,
  type SimulationEvent,
  type SimulationResult,
} from './types'
import { parseProblem } from './validation'

interface RuntimeProcess {
  readonly input: ProcessInput
  state: ProcessState
}

interface Engine {
  readonly processes: RuntimeProcess[]
  readonly readyQueue: RuntimeProcess[]
  readonly ioQueue: RuntimeProcess[]
  cpu: RuntimeProcess | null
  io: RuntimeProcess | null
  completionTime: number | null
}

function completeWork(
  engine: Engine,
  time: number,
  events: SimulationEvent[],
): RuntimeProcess | null {
  const cpu = engine.cpu
  if (cpu?.state.status === 'running' && cpu.state.remainingCpu === 0) {
    events.push({
      type: 'cpu-burst-completed',
      processId: cpu.input.id,
      burst: cpu.state.burst,
    })
    if (cpu.state.burst === 1) {
      cpu.state = {
        processId: cpu.input.id,
        status: 'waiting-for-io',
        remainingIo: cpu.input.io,
        requestedAt: time,
      }
      // A newly blocked process joins behind all older I/O requests.
      engine.ioQueue.push(cpu)
      events.push({ type: 'io-requested', processId: cpu.input.id })
    } else {
      cpu.state = { processId: cpu.input.id, status: 'completed', completedAt: time }
      events.push({ type: 'process-completed', processId: cpu.input.id })
    }
    engine.cpu = null
  }

  let returnedFromIo: RuntimeProcess | null = null
  const io = engine.io
  if (io?.state.status === 'performing-io' && io.state.remainingIo === 0) {
    events.push({ type: 'io-completed', processId: io.input.id })
    returnedFromIo = io
    engine.io = null
  }

  if (
    engine.completionTime === null &&
    engine.processes.every((process) => process.state.status === 'completed')
  ) {
    engine.completionTime = time
  }
  return returnedFromIo
}

function addNewlyReady(
  engine: Engine,
  time: number,
  returnedFromIo: RuntimeProcess | null,
  events: SimulationEvent[],
): void {
  const newlyReady = engine.processes.filter(
    (process) => process.state.status === 'not-arrived' && process.input.arrival === time,
  )
  if (returnedFromIo !== null) newlyReady.push(returnedFromIo)
  newlyReady.sort((a, b) => compareProcessIds(a.input.id, b.input.id))

  for (const process of newlyReady) {
    const returning = process === returnedFromIo
    process.state = {
      processId: process.input.id,
      status: 'ready',
      burst: returning ? 2 : 1,
      remainingCpu: returning ? process.input.cpu2 : process.input.cpu1,
      enteredAt: time,
    }
    // Keep existing waiters in place; only this boundary's additions are sorted.
    engine.readyQueue.push(process)
    events.push({
      type: 'became-ready',
      processId: process.input.id,
      reason: returning ? 'io-completion' : 'arrival',
    })
  }
}

function expireQuantum(engine: Engine, time: number, events: SimulationEvent[]): void {
  const process = engine.cpu
  if (process === null) return
  const state = process.state
  if (
    state.status !== 'running' ||
    state.quantumRemaining === null ||
    !shouldRequeueAfterQuantum(state.remainingCpu, state.quantumRemaining)
  ) {
    return
  }

  // Completion was handled first, and arrivals/I/O returns are already queued.
  process.state = {
    processId: process.input.id,
    status: 'ready',
    burst: state.burst,
    remainingCpu: state.remainingCpu,
    enteredAt: time,
  }
  engine.readyQueue.push(process)
  engine.cpu = null
  events.push({
    type: 'quantum-expired',
    processId: process.input.id,
    remainingCpu: state.remainingCpu,
  })
}

function dispatchIo(engine: Engine, time: number, events: SimulationEvent[]): void {
  if (engine.io !== null) return

  const process = engine.ioQueue.shift()
  if (process === undefined) return
  if (process.state.status !== 'waiting-for-io') {
    throw new Error('An I/O queue entry is not waiting for I/O.')
  }
  process.state = {
    processId: process.input.id,
    status: 'performing-io',
    remainingIo: process.state.remainingIo,
    startedAt: time,
  }
  engine.io = process
  events.push({ type: 'io-started', processId: process.input.id })
}

function cpuCandidate(process: RuntimeProcess): CpuCandidate {
  if (process.state.status !== 'ready' && process.state.status !== 'running') {
    throw new Error('A CPU candidate is neither ready nor running.')
  }
  return {
    processId: process.input.id,
    enteredAt: process.state.enteredAt,
    burst: process.state.burst,
    remainingCpu: process.state.remainingCpu,
    ...(process.input.priority === undefined ? {} : { priority: process.input.priority }),
  }
}

function compareCandidates(
  a: RuntimeProcess,
  b: RuntimeProcess,
  settings: SchedulingSettings,
): number {
  if (settings.algorithm === 'fcfs-course') return compareLaunchOrder(a.input, b.input)
  // Keep the actual FIFO order, including an expired process appended last.
  if (settings.algorithm === 'round-robin') return 0
  const first = cpuCandidate(a)
  const second = cpuCandidate(b)
  const rank = settings.algorithm === 'priority'
    // parseProblem requires safe integer priorities before simulation starts.
    ? first.priority! - second.priority!
    : first.remainingCpu - second.remainingCpu
  return rank || compareReadyEntries(first, second)
}

function selectReadyProcess(engine: Engine, settings: SchedulingSettings): RuntimeProcess {
  return engine.readyQueue.reduce((best, candidate) =>
    compareCandidates(candidate, best, settings) < 0 ? candidate : best,
  )
}

function preemptCpu(
  engine: Engine,
  time: number,
  settings: SchedulingSettings,
  events: SimulationEvent[],
): void {
  if (
    engine.cpu === null ||
    engine.readyQueue.length === 0 ||
    (settings.algorithm !== 'srtf' &&
      !(settings.algorithm === 'priority' && settings.mode === 'preemptive'))
  ) {
    return
  }

  const process = engine.cpu
  const running = cpuCandidate(process)
  const challenger = cpuCandidate(selectReadyProcess(engine, settings))
  // Selection ties never interrupt the current burst.
  if (!shouldPreempt(settings, running, challenger)) return

  events.push({
    type: 'cpu-preempted',
    reason: settings.algorithm === 'srtf' ? 'shorter-remaining-burst' : 'higher-priority',
    running,
    challenger,
  })
  process.state = {
    processId: process.input.id,
    status: 'ready',
    burst: running.burst,
    remainingCpu: running.remainingCpu,
    enteredAt: time,
  }
  // Newly ready processes have already joined; the interrupted process joins last.
  engine.readyQueue.push(process)
  engine.cpu = null
}

function dispatchCriterion(
  settings: SchedulingSettings,
): Extract<SimulationEvent, { type: 'cpu-dispatched' }>['criterion'] {
  switch (settings.algorithm) {
    case 'fcfs-course': return 'original-launch-order'
    case 'round-robin': return 'fifo-ready-queue'
    case 'sjf': return 'shortest-current-burst'
    case 'srtf': return 'shortest-remaining-burst'
    case 'priority': return 'highest-priority'
  }
}

function dispatchCpu(
  engine: Engine,
  settings: SchedulingSettings,
  events: SimulationEvent[],
): void {
  if (engine.cpu !== null || engine.readyQueue.length === 0) return

  // Select without rearranging the queue, preserving FIFO history for explanations.
  const process = selectReadyProcess(engine, settings)
  const candidates = engine.readyQueue.map(cpuCandidate)
  const selected = cpuCandidate(process)
  engine.readyQueue.splice(engine.readyQueue.indexOf(process), 1)
  process.state = {
    processId: process.input.id,
    status: 'running',
    burst: selected.burst,
    remainingCpu: selected.remainingCpu,
    enteredAt: selected.enteredAt,
    quantumRemaining: settings.algorithm === 'round-robin' ? settings.quantum : null,
  }
  engine.cpu = process
  events.push({
    type: 'cpu-dispatched',
    processId: process.input.id,
    burst: selected.burst,
    candidates,
    criterion: dispatchCriterion(settings),
  })
}

function recordIdleResources(engine: Engine, events: SimulationEvent[]): void {
  const allCompleted = engine.completionTime !== null
  if (engine.cpu === null) {
    events.push({
      type: 'resource-idle',
      resource: 'cpu',
      reason: allCompleted ? 'all-completed' : 'no-ready-process',
    })
  }
  if (engine.io === null) {
    events.push({
      type: 'resource-idle',
      resource: 'io',
      reason: allCompleted ? 'all-completed' : 'no-io-request',
    })
  }
}

function snapshotState(engine: Engine, events: SimulationEvent[]) {
  const readyQueue: ReadyQueueEntry[] = engine.readyQueue.map((process) => {
    const candidate = cpuCandidate(process)
    return { processId: candidate.processId, enteredAt: candidate.enteredAt }
  })
  const ioQueue: IoQueueEntry[] = engine.ioQueue.map((process) => {
    if (process.state.status !== 'waiting-for-io') {
      throw new Error('An I/O queue entry is not waiting for I/O.')
    }
    return { processId: process.input.id, requestedAt: process.state.requestedAt }
  })
  return {
    processes: engine.processes.map((process) => ({ ...process.state })),
    readyQueue,
    ioQueue,
    events: [...events],
  }
}

function executeInterval(engine: Engine): void {
  if (engine.cpu !== null) {
    const state = engine.cpu.state
    if (state.status !== 'running' || state.remainingCpu <= 0) {
      throw new Error('The CPU cannot execute a process without remaining CPU work.')
    }
    if (state.quantumRemaining !== null && state.quantumRemaining <= 0) {
      throw new Error('The CPU cannot execute a process with an expired quantum.')
    }
    engine.cpu.state = {
      ...state,
      remainingCpu: state.remainingCpu - 1,
      quantumRemaining: state.quantumRemaining === null ? null : state.quantumRemaining - 1,
    }
  }
  if (engine.io !== null) {
    const state = engine.io.state
    if (state.status !== 'performing-io' || state.remainingIo <= 0) {
      throw new Error('The I/O device cannot execute a process without remaining I/O work.')
    }
    engine.io.state = { ...state, remainingIo: state.remainingIo - 1 }
  }
}

/**
 * Simulate the selected policy without mutating the problem or using external state.
 * Invalid inputs throw instead of producing an answer.
 * Valid workloads that do not finish by 40 return limit-reached with their progress.
 */
export function simulate(input: Problem): SimulationResult {
  const parsed = parseProblem(input)
  if (!parsed.valid) {
    throw new TypeError(
      `Invalid scheduling problem: ${parsed.issues
        .map((issue) => `${issue.path || 'problem'}: ${issue.message}`)
        .join('; ')}`,
    )
  }
  const problem = parsed.value
  const settings = problem.settings
  const engine: Engine = {
    processes: problem.processes
      .toSorted((a, b) => compareProcessIds(a.id, b.id))
      .map((process) => ({
        input: process,
        state: { processId: process.id, status: 'not-arrived' },
      })),
    readyQueue: [],
    ioQueue: [],
    cpu: null,
    io: null,
    completionTime: null,
  }
  const cpu: ReferenceCell[] = []
  const io: ReferenceCell[] = []
  const boundaries: BoundarySnapshot[] = []

  for (let time = 0; time <= TIMELINE_LENGTH; time++) {
    const events: SimulationEvent[] = []
    let returnedFromIo: RuntimeProcess | null = null
    for (const phase of getBoundaryPhases(time)) {
      switch (phase) {
        case 'completions':
          returnedFromIo = completeWork(engine, time, events)
          break
        case 'newly-ready':
          addNewlyReady(engine, time, returnedFromIo, events)
          break
        case 'preemption':
          if (settings.algorithm === 'round-robin') expireQuantum(engine, time, events)
          else preemptCpu(engine, time, settings, events)
          break
        case 'dispatch':
          dispatchIo(engine, time, events)
          dispatchCpu(engine, settings, events)
          recordIdleResources(engine, events)
          break
        case 'execute': {
          const cpuOwner = engine.cpu?.input.id ?? 'idle'
          const ioOwner = engine.io?.input.id ?? 'idle'
          boundaries.push({
            kind: 'interval-start',
            time,
            ...snapshotState(engine, events),
            cpu: cpuOwner,
            io: ioOwner,
          })
          cpu.push(cpuOwner)
          io.push(ioOwner)
          executeInterval(engine)
          break
        }
      }
    }
    if (time === TIMELINE_LENGTH) {
      boundaries.push({
        kind: 'terminal',
        time,
        ...snapshotState(engine, events),
      })
    }
  }

  const result = { timeline: { cpu, io }, boundaries }
  return engine.completionTime === null
    ? { ...result, status: 'limit-reached', completionTime: null }
    : { ...result, status: 'complete', completionTime: engine.completionTime }
}
