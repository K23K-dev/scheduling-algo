import { useReducer, useRef, useState, type FormEvent } from 'react'
import { createProblemSeed, generateProblem } from './scheduling/generator'
import { getSchedulingRule } from './scheduling/rules'
import { gradeAttempt, type GradeResult } from './scheduling/grader'
import { getHint, type HintLevel, type HintResult } from './scheduling/hints'
import { simulate } from './scheduling/simulator'
import type { Problem, SchedulingSettings, SimulationResult } from './scheduling/types'
import { updateProblemSettings } from './practice/settings'
import { ProcessTable, RulesPanel } from './practice/Workspace'
import { Worksheet } from './practice/Worksheet'
import { ReplaceProblemDialog } from './practice/ReplaceProblemDialog'
import { SolutionPlayback } from './practice/SolutionPlayback'
import { attemptReducer, createAttemptHistory, type AttemptAction } from './practice/attempt'
import styles from './App.module.css'

type AvailableAlgorithm = SchedulingSettings['algorithm']
type PriorityMode = Extract<SchedulingSettings, { algorithm: 'priority' }>['mode']

export default function App() {
  const [problem, setProblem] = useState(() =>
    generateProblem(createProblemSeed(), { algorithm: 'fcfs-course' }),
  )
  const [algorithm, setAlgorithm] = useState<AvailableAlgorithm>('fcfs-course')
  const [quantum, setQuantum] = useState('2')
  const [priorityMode, setPriorityMode] = useState<PriorityMode>('non-preemptive')
  const [quantumError, setQuantumError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [history, editAttempt] = useReducer(attemptReducer, undefined, createAttemptHistory)
  const [replacement, setReplacement] = useState<Problem | null>(null)
  const [feedback, setFeedback] = useState<GradeResult | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [hint, setHint] = useState<HintResult | null>(null)
  const [helpError, setHelpError] = useState<string | null>(null)
  const [solution, setSolution] = useState<SimulationResult | null>(null)
  const [assisted, setAssisted] = useState(false)
  const revealButtonRef = useRef<HTMLButtonElement>(null)
  const activeRule = getSchedulingRule(problem.settings)
  const pendingSettings = algorithm !== problem.settings.algorithm ||
    (problem.settings.algorithm === 'round-robin' && Number(quantum) !== problem.settings.quantum) ||
    (problem.settings.algorithm === 'priority' && priorityMode !== problem.settings.mode)

  function clearFeedback() {
    setFeedback(null)
    setCheckError(null)
    setHint(null)
    setHelpError(null)
  }

  function resetAttempt() {
    editAttempt({ type: 'reset' })
    clearFeedback()
    setSolution(null)
    setAssisted(false)
  }

  function handleEdit(action: AttemptAction) {
    editAttempt(action)
    clearFeedback()
  }

  function handleCheck() {
    clearFeedback()
    try {
      setFeedback(gradeAttempt(problem, history.present))
    } catch {
      setCheckError('Your answer could not be checked. Please try again.')
    }
  }

  function handleHint(level: HintLevel) {
    clearFeedback()
    try {
      const next = getHint(problem, history.present, level)
      setHint(next)
      if (next.status === 'hint' && next.level === 3) setAssisted(true)
    } catch {
      setHelpError('Your hint could not be prepared. Please try again.')
    }
  }

  function handleReveal() {
    clearFeedback()
    try {
      const next = simulate(problem)
      if (next.status !== 'complete') throw new Error('The solution must fit the worksheet.')
      setSolution(next)
      setAssisted(true)
    } catch {
      setHelpError('The solution could not be prepared. Please try again.')
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    if (
      algorithm === 'round-robin' &&
      (quantum.trim() === '' || !Number.isSafeInteger(Number(quantum)) || Number(quantum) < 1)
    ) {
      setQuantumError('Enter a whole number of at least 1.')
      event.currentTarget.querySelector<HTMLInputElement>('#quantum')?.focus()
      return
    }
    setQuantumError(null)
    const settings: SchedulingSettings = algorithm === 'round-robin'
      ? { algorithm, quantum: Number(quantum) }
      : algorithm === 'priority'
        ? { algorithm, mode: priorityMode }
        : { algorithm }
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')

    try {
      if (action === 'new') {
        const next = generateProblem(createProblemSeed(problem.seed), settings)
        setProblem(next)
        resetAttempt()
      } else if (pendingSettings) {
        const updated = updateProblemSettings(problem, settings, createProblemSeed(problem.seed))
        const hasAttempt = history.present.cpu.some((cell) => cell !== null) ||
          history.present.io.some((cell) => cell !== null) ||
          history.past.length > 0 || history.future.length > 0
        if (updated.replaced && hasAttempt) {
          setReplacement(updated.problem)
          return
        }
        setProblem(updated.problem)
        clearFeedback()
        setSolution(null)
        if (updated.replaced) resetAttempt()
        setNotice(updated.replaced
          ? 'The previous workload would exceed 40 blocks with these settings. A new problem is ready.'
          : null)
      }
    } catch {
      setError('This problem could not be prepared. Please try again.')
    }
  }

  return (
    <main className={styles.workspace}>
      <a className={styles.skipLink} href="#worksheet-title">Skip to practice</a>
      <header className={styles.header}>
        <a href="#app-title" className={styles.brand} aria-label="Scheduling Algo home">
          <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>
          <span>Scheduling Algo</span>
        </a>
        <span className={styles.course}>CS2200 <span aria-hidden="true">/</span> UNIT 3</span>
      </header>

      <section className={styles.introduction} aria-labelledby="app-title">
        <h1 id="app-title">Scheduling Algo</h1>
        <div className={styles.model} aria-label="Each process runs CPU 1, then I/O, then CPU 2">
          <span>CPU 1</span><b aria-hidden="true">→</b><span>I/O</span><b aria-hidden="true">→</b><span>CPU 2</span>
        </div>
      </section>

      <section className={styles.controls} aria-labelledby="settings-title">
        <div className={styles.sectionHeading}>
          <h2 id="settings-title"><span className={styles.step}>01</span> Set up your problem</h2>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.controlFields}>
            <div className={styles.algorithmField}>
              <label htmlFor="algorithm">Algorithm</label>
              <select
                id="algorithm"
                value={algorithm}
                aria-describedby={pendingSettings ? 'settings-help' : undefined}
                onChange={(event) => {
                  const value = event.target.value
                  if (
                    value === 'fcfs-course' || value === 'round-robin' ||
                    value === 'sjf' || value === 'srtf' || value === 'priority'
                  ) {
                    setAlgorithm(value)
                    setQuantumError(null)
                    setError(null)
                  }
                }}
              >
                <option value="fcfs-course">FCFS — course launch order</option>
                <option value="round-robin">Round robin</option>
                <option value="sjf">SJF</option>
                <option value="srtf">SRTF</option>
                <option value="priority">Priority</option>
              </select>
            </div>
            {algorithm === 'round-robin' ? (
              <div className={styles.quantumField}>
                <label htmlFor="quantum">Time quantum</label>
                <input
                  id="quantum"
                  type="number"
                  min="1"
                  max={Number.MAX_SAFE_INTEGER}
                  step="1"
                  required
                  value={quantum}
                  aria-invalid={quantumError !== null}
                  aria-describedby={quantumError ? 'quantum-error' : 'quantum-help'}
                  onChange={(event) => {
                    setQuantum(event.target.value)
                    setQuantumError(null)
                  }}
                />
              </div>
            ) : null}
            {algorithm === 'priority' ? (
              <div className={styles.priorityField}>
                <label htmlFor="priority-mode">Priority mode</label>
                <select
                  id="priority-mode"
                  value={priorityMode}
                  aria-describedby="priority-help"
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === 'preemptive' || value === 'non-preemptive') {
                      setPriorityMode(value)
                      setError(null)
                    }
                  }}
                >
                  <option value="non-preemptive">Non-preemptive</option>
                  <option value="preemptive">Preemptive</option>
                </select>
              </div>
            ) : null}
            <div className={styles.actions}>
              <button type="submit" name="action" value="apply" className={styles.secondaryButton}>
                Apply settings
              </button>
              <button type="submit" name="action" value="new" className={styles.primaryButton}>
                <span aria-hidden="true">＋</span> New problem
              </button>
            </div>
          </div>
          {pendingSettings || algorithm === 'round-robin' || algorithm === 'priority' ? (
            <div className={styles.controlHelp}>
              {pendingSettings ? (
                <p id="settings-help">Changes are pending. Apply settings to reuse this workload, or start a new problem.</p>
              ) : null}
              {algorithm === 'round-robin' ? <p id="quantum-help">Try a quantum of 2–4 time units.</p> : null}
              {algorithm === 'priority' ? (
                <p id="priority-help">Smaller numbers mean higher priority. Apply settings to see the process priorities.</p>
              ) : null}
            </div>
          ) : null}
          {quantumError ? <p id="quantum-error" className={styles.error} role="alert">{quantumError}</p> : null}
        </form>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        {notice ? <p className={styles.notice} role="status"><span aria-hidden="true" />{notice}</p> : null}
      </section>

      <div className={styles.problemHeader}>
        <p><span className={styles.liveDot} aria-hidden="true" /> Current problem <b>{activeRule.label}</b></p>
      </div>
      <div className={styles.problemLayout}>
        <ProcessTable processes={problem.processes} showPriority={problem.settings.algorithm === 'priority'} />
        <RulesPanel settings={problem.settings} />
      </div>
      <Worksheet
        key={problem.seed}
        processes={problem.processes}
        history={history}
        onEdit={handleEdit}
        onCheck={handleCheck}
        feedback={feedback}
        checkError={checkError}
        pendingSettings={pendingSettings}
        hint={hint}
        onHint={handleHint}
        onReveal={handleReveal}
        solutionVisible={solution !== null}
        revealButtonRef={revealButtonRef}
        assisted={assisted}
        helpError={helpError}
        onRetry={() => {
          resetAttempt()
          setNotice(null)
        }}
      />
      {solution ? (
        <SolutionPlayback
          problem={problem}
          solution={solution}
          returnFocusRef={revealButtonRef}
          onClose={() => setSolution(null)}
        />
      ) : null}
      {replacement ? (
        <ReplaceProblemDialog
          onCancel={() => {
            setReplacement(null)
            setNotice(null)
          }}
          onConfirm={() => {
            setProblem(replacement)
            resetAttempt()
            setReplacement(null)
            setNotice('The previous workload would exceed 40 blocks with these settings. A new problem is ready.')
          }}
        />
      ) : null}
    </main>
  )
}
