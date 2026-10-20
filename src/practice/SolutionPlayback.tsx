import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { explainInterval } from '../scheduling/grader'
import { getSchedulingRule } from '../scheduling/rules'
import { TIME_BOUNDARIES } from '../scheduling/timeline'
import {
  TIMELINE_LENGTH,
  type Problem,
  type ProcessInput,
  type ProcessState,
  type ReferenceCell,
  type SimulationEvent,
  type SimulationResult,
} from '../scheduling/types'
import workspace from '../App.module.css'
import styles from './SolutionPlayback.module.css'

interface SolutionPlaybackProps {
  readonly problem: Problem
  readonly solution: SimulationResult
  readonly onClose: () => void
  readonly returnFocusRef?: RefObject<HTMLButtonElement | null>
}

const intervals = TIME_BOUNDARIES.slice(0, TIMELINE_LENGTH)
const resources = [{ id: 'cpu', label: 'CPU' }, { id: 'io', label: 'I/O' }] as const

function assignment(value: ReferenceCell): string {
  return value === 'idle' ? 'Idle' : value
}

function stateLabel(state: ProcessState): string {
  switch (state.status) {
    case 'not-arrived': return 'Not arrived'
    case 'ready': return `Ready for CPU burst ${state.burst}`
    case 'running': return `Running CPU burst ${state.burst}`
    case 'waiting-for-io': return 'Waiting for I/O'
    case 'performing-io': return 'Performing I/O'
    case 'completed': return `Completed at time ${state.completedAt}`
  }
}

function remainingWork(state: ProcessState, process: ProcessInput): string {
  switch (state.status) {
    case 'not-arrived':
      return `CPU 1: ${process.cpu1} · I/O: ${process.io} · CPU 2: ${process.cpu2}`
    case 'ready':
    case 'running':
      return state.burst === 1
        ? `CPU 1: ${state.remainingCpu} · I/O: ${process.io} · CPU 2: ${process.cpu2}`
        : `CPU 2: ${state.remainingCpu}`
    case 'waiting-for-io':
    case 'performing-io':
      return `I/O: ${state.remainingIo} · CPU 2: ${process.cpu2}`
    case 'completed':
      return 'None'
  }
}

function stateDetail(state: ProcessState, process: ProcessInput): string {
  switch (state.status) {
    case 'not-arrived': return `Arrives at time ${process.arrival}`
    case 'ready': return `Ready since time ${state.enteredAt}`
    case 'running':
      return state.quantumRemaining === null
        ? ''
        : `Quantum remaining: ${state.quantumRemaining}`
    case 'waiting-for-io': return `Requested at time ${state.requestedAt}`
    case 'performing-io': return `Started at time ${state.startedAt}`
    case 'completed': return ''
  }
}

function eventLabel(event: SimulationEvent): string {
  switch (event.type) {
    case 'cpu-burst-completed': return `${event.processId} completed CPU burst ${event.burst}.`
    case 'io-requested': return `${event.processId} requested I/O.`
    case 'io-completed': return `${event.processId} completed I/O.`
    case 'process-completed': return `${event.processId} completed all its work.`
    case 'became-ready':
      return event.reason === 'arrival'
        ? `${event.processId} arrived and became ready.`
        : `${event.processId} became ready after I/O.`
    case 'quantum-expired':
      return `${event.processId}'s quantum expired with ${event.remainingCpu} CPU units remaining.`
    case 'cpu-preempted':
      return `${event.running.processId} was preempted because ${event.challenger.processId} has ${
        event.reason === 'higher-priority' ? 'a higher priority' : 'a shorter remaining CPU burst'
      }.`
    case 'io-started': return `${event.processId} started I/O.`
    case 'cpu-dispatched': return `${event.processId} started CPU burst ${event.burst}.`
    case 'resource-idle': return `${event.resource === 'cpu' ? 'CPU' : 'I/O'} is Idle.`
  }
}

export function SolutionPlayback({ problem, solution, onClose, returnFocusRef }: SolutionPlaybackProps) {
  const [playback, setPlayback] = useState({ time: 0, playing: false })
  const timelineRef = useRef<HTMLDivElement>(null)
  const currentBoundaryRef = useRef<HTMLSpanElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const sliderRef = useRef<HTMLInputElement>(null)
  const playButtonRef = useRef<HTMLButtonElement>(null)
  const playOwnedFocusRef = useRef(false)
  const closingRef = useRef(false)
  const sliderId = useId()
  const { time, playing } = playback
  const boundary = solution.boundaries[time]
  const rule = getSchedulingRule(problem.settings)
  const explanation = boundary.kind === 'interval-start'
    ? explainInterval(problem, solution, time)
    : null

  useEffect(() => {
    const returnTarget = returnFocusRef?.current
    headingRef.current?.focus()
    return () => {
      // Only explicit hiding returns to Reveal; applying settings keeps focus
      // on the settings control that caused the playback to be removed.
      if (closingRef.current && returnTarget?.isConnected) returnTarget.focus()
    }
  }, [returnFocusRef])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      playOwnedFocusRef.current = document.activeElement === playButtonRef.current
      setPlayback((current) => {
        const next = Math.min(TIMELINE_LENGTH, current.time + 1)
        return { time: next, playing: next < TIMELINE_LENGTH }
      })
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [playing])

  useEffect(() => {
    const pause = () => setPlayback((current) =>
      current.playing ? { ...current, playing: false } : current)
    const pauseWhenHidden = () => { if (document.hidden) pause() }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    window.addEventListener('blur', pause)
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenHidden)
      window.removeEventListener('blur', pause)
    }
  }, [])

  useEffect(() => {
    // Recover only focus lost by Play becoming disabled, not intentional focus
    // elsewhere in the worksheet or on the page background.
    if (time === TIMELINE_LENGTH && playOwnedFocusRef.current && (
      document.activeElement === playButtonRef.current || document.activeElement === document.body
    )) sliderRef.current?.focus({ preventScroll: true })
    playOwnedFocusRef.current = false
    // Follow the selected boundary horizontally without moving the page away
    // from playback controls or the explanation the learner is reading.
    const region = timelineRef.current
    const marker = currentBoundaryRef.current
    if (!region || !marker) return
    const viewport = region.getBoundingClientRect()
    const selected = marker.getBoundingClientRect()
    const resourceWidth = region.querySelector('tbody th')?.getBoundingClientRect().width ?? 0
    const left = viewport.left + resourceWidth + 24
    const right = viewport.right - 24
    if (selected.left < left) region.scrollLeft -= left - selected.left
    else if (selected.right > right) region.scrollLeft += selected.right - right
  }, [time])

  function navigate(next: number) {
    const nextTime = Math.min(TIMELINE_LENGTH, Math.max(0, next))
    // Endpoint buttons disable themselves; keep keyboard navigation available.
    if (nextTime === 0 || nextTime === TIMELINE_LENGTH) sliderRef.current?.focus({ preventScroll: true })
    setPlayback({ time: nextTime, playing: false })
  }

  function close() {
    closingRef.current = true
    setPlayback((current) => ({ ...current, playing: false }))
    onClose()
  }

  return (
    <section className={`${workspace.panel} ${styles.playback}`} aria-labelledby="playback-title">
      <div className={`${workspace.panelHeading} ${styles.heading}`}>
        <h2 id="playback-title" ref={headingRef} tabIndex={-1}><span className={workspace.step}>04</span> Solution playback</h2>
        <button type="button" onClick={close}>Hide solution</button>
      </div>
      <div className={styles.introduction}>
        <p>The full solution is revealed. Your timeline stays separate and editable.</p>
        <p><b>{rule.label}</b> · All processes finish at time <b>{solution.completionTime}</b>.</p>
      </div>
      <div className={styles.controls} role="group" aria-label="Playback controls">
        <button
          type="button"
          ref={playButtonRef}
          className={styles.playButton}
          disabled={time === TIMELINE_LENGTH}
          onClick={() => setPlayback((current) => ({
            ...current,
            playing: !current.playing && !document.hidden,
          }))}
        >{playing ? 'Pause' : 'Play'}</button>
        <button type="button" disabled={time === 0} onClick={() => navigate(time - 1)}>Previous step</button>
        <button type="button" disabled={time === TIMELINE_LENGTH} onClick={() => navigate(time + 1)}>Next step</button>
        <button type="button" disabled={time === 0} onClick={() => navigate(0)}>Back to start</button>
        <button type="button" disabled={time === TIMELINE_LENGTH} onClick={() => navigate(TIMELINE_LENGTH)}>Go to end</button>
      </div>
      <div className={styles.scrubber}>
        <label htmlFor={sliderId}>Playback time</label>
        <span className={styles.time} aria-live={playing ? 'off' : 'polite'}>Time {time} / {TIMELINE_LENGTH}</span>
        <input
          id={sliderId}
          ref={sliderRef}
          type="range"
          min={0}
          max={TIMELINE_LENGTH}
          step={1}
          value={time}
          aria-valuetext={boundary.kind === 'terminal'
            ? 'Time 40, terminal boundary'
            : `Time ${time}, interval ${time} to ${time + 1}`}
          onChange={(event) => navigate(Number(event.target.value))}
        />
      </div>
      <div
        ref={timelineRef}
        className={workspace.timelineScroll}
        role="region"
        aria-label="Scrollable reference solution"
        tabIndex={0}
      >
        <table className={workspace.timeline} aria-label="Reference solution">
          <colgroup><col className={workspace.resourceColumn} /><col span={TIMELINE_LENGTH} /></colgroup>
          <thead>
            <tr>
              <th scope="col" className={workspace.axisLabel}>Time</th>
              {intervals.map((interval) => (
                <th
                  key={interval}
                  scope="col"
                  className={workspace.timeBoundary}
                  aria-label={`Time ${interval} to ${interval + 1}`}
                >
                  <span
                    ref={time === interval ? currentBoundaryRef : undefined}
                    className={styles.boundary}
                    data-current={time === interval || undefined}
                    aria-current={time === interval ? 'step' : undefined}
                  >{interval}</span>
                  {interval === TIMELINE_LENGTH - 1 ? (
                    <span
                      ref={time === TIMELINE_LENGTH ? currentBoundaryRef : undefined}
                      className={`${workspace.finalBoundary} ${styles.boundary}`}
                      data-current={time === TIMELINE_LENGTH || undefined}
                      aria-current={time === TIMELINE_LENGTH ? 'step' : undefined}
                    >{TIMELINE_LENGTH}</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resources.map(({ id, label }) => (
              <tr key={id}>
                <th scope="row" className={workspace.resourceLabel}>{label}</th>
                {solution.timeline[id].map((value, interval) => (
                  <td
                    key={interval}
                    className={`${workspace.timelineCell} ${styles.referenceCell} ${
                      interval % 5 === 0 ? workspace.majorBoundary : ''
                    }`}
                    data-value={value}
                    data-current={time === interval || undefined}
                    aria-label={`${label}, time ${interval} to ${interval + 1}: ${assignment(value)}`}
                  >{assignment(value)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.details}>
        <div className={styles.boundaryHeading}>
          <h3>{boundary.kind === 'terminal' ? 'Time 40 — terminal boundary' : `Time ${time}–${time + 1}`}</h3>
          <span>{boundary.kind === 'terminal' ? 'Bookkeeping only' : 'Before this interval runs'}</span>
        </div>
        {boundary.kind === 'interval-start' && explanation ? (
          <div className={styles.decisions}>
            {resources.map(({ id, label }) => (
              <article key={id} className={styles.decision} aria-label={`${label} decision`}>
                <h4>{label} <span data-value={boundary[id]}>{assignment(boundary[id])}</span></h4>
                <p>{explanation[id]}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.terminal}>
            <p>Time 40 closes the worksheet. Completions and queue updates are recorded, but no new interval starts and neither resource is dispatched.</p>
            <h4>Events at time 40</h4>
            {boundary.events.length > 0
              ? <ul>{boundary.events.map((event, index) => <li key={index}>{eventLabel(event)}</li>)}</ul>
              : <p>No additional events at this boundary.</p>}
          </div>
        )}
        <div className={styles.queues}>
          <article>
            <h4>Ready queue {boundary.kind === 'terminal' ? 'at boundary 40' : 'after dispatch'}</h4>
            {boundary.readyQueue.length === 0 ? <p className={styles.empty}>Empty</p> : (
              <ol aria-label="Ready queue order">
                {boundary.readyQueue.map((entry) => (
                  <li key={entry.processId}>
                    <b className={workspace.processBadge} data-process={entry.processId}>{entry.processId}</b>
                    <span>Ready since {entry.enteredAt}</span>
                  </li>
                ))}
              </ol>
            )}
          </article>
          <article>
            <h4>I/O queue {boundary.kind === 'terminal' ? 'at boundary 40' : 'after dispatch'}</h4>
            {boundary.ioQueue.length === 0 ? <p className={styles.empty}>Empty</p> : (
              <ol aria-label="I/O queue order">
                {boundary.ioQueue.map((entry) => (
                  <li key={entry.processId}>
                    <b className={workspace.processBadge} data-process={entry.processId}>{entry.processId}</b>
                    <span>Requested at {entry.requestedAt}</span>
                  </li>
                ))}
              </ol>
            )}
          </article>
        </div>
        <p className={styles.queueHelp}>
          Queues show entry order, with active processes excluded. CPU selection follows {rule.label};
          the ready queue is not sorted by burst length or priority. I/O serves requests in FIFO order.
        </p>
        <h4 className={styles.stateHeading}>Process states at time {time}</h4>
        <p className={styles.stateHelp}>Remaining work is measured in time units{boundary.kind === 'terminal' ? '.' : ', before this interval executes.'}</p>
        <div className={styles.stateScroll} role="region" aria-label="Scrollable process states" tabIndex={0}>
          <table className={styles.stateTable} aria-label="Playback process states">
            <thead>
              <tr>
                <th scope="col">Process</th>
                {problem.settings.algorithm === 'priority' ? <th scope="col">Priority</th> : null}
                <th scope="col">State</th>
                <th scope="col">Remaining work</th>
              </tr>
            </thead>
            <tbody>
              {boundary.processes.map((state) => {
                const process = problem.processes.find((input) => input.id === state.processId)!
                const detail = stateDetail(state, process)
                return (
                  <tr key={state.processId}>
                    <th scope="row"><span className={workspace.processBadge} data-process={state.processId}>{state.processId}</span></th>
                    {problem.settings.algorithm === 'priority' ? <td>{process.priority}</td> : null}
                    <td>{stateLabel(state)}{detail ? <small>{detail}</small> : null}</td>
                    <td className={styles.remaining}>{remainingWork(state, process)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
