import { useReducer, useRef, useState, type FormEvent } from 'react'
import { createProblemSeed, generateProblem } from './scheduling/generator'
import { gradeAttempt, type GradeResult } from './scheduling/grader'
import { simulate } from './scheduling/simulator'
import type { SchedulingSettings, SimulationResult } from './scheduling/types'
import { ProcessTable } from './practice/Workspace'
import { Worksheet } from './practice/Worksheet'
import { SolutionPlayback } from './practice/SolutionPlayback'
import { attemptReducer, createAttemptHistory, type AttemptAction } from './practice/attempt'
import styles from './App.module.css'

type AvailableAlgorithm = SchedulingSettings['algorithm']
type PriorityMode = Extract<SchedulingSettings, { algorithm: 'priority' }>['mode']

export default function App() {
  const [problem, setProblem] = useState(() =>
    generateProblem(createProblemSeed(), { algorithm: 'fcfs-course' }),
  )
  const [quantum, setQuantum] = useState('2')
  const [priorityMode, setPriorityMode] = useState<PriorityMode>('non-preemptive')
  const [quantumError, setQuantumError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, editAttempt] = useReducer(attemptReducer, undefined, createAttemptHistory)
  const [feedback, setFeedback] = useState<GradeResult | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [helpError, setHelpError] = useState<string | null>(null)
  const [solution, setSolution] = useState<SimulationResult | null>(null)
  const [assisted, setAssisted] = useState(false)
  const revealButtonRef = useRef<HTMLButtonElement>(null)
  const algorithm = problem.settings.algorithm

  function clearFeedback() {
    setFeedback(null)
    setCheckError(null)
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

  function newProblem(settings: SchedulingSettings): boolean {
    setError(null)
    try {
      const next = generateProblem(createProblemSeed(problem.seed), settings)
      setProblem(next)
      if (settings.algorithm === 'round-robin') setQuantum(String(settings.quantum))
      if (settings.algorithm === 'priority') setPriorityMode(settings.mode)
      setQuantumError(null)
      resetAttempt()
      return true
    } catch {
      setError('This problem could not be prepared. Please try again.')
      return false
    }
  }

  function validQuantum(value: string): boolean {
    return value.trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 1
  }

  function changeAlgorithm(next: AvailableAlgorithm) {
    if (next === algorithm) return
    newProblem(next === 'round-robin'
      ? { algorithm: next, quantum: validQuantum(quantum) ? Number(quantum) : 2 }
      : next === 'priority'
        ? { algorithm: next, mode: priorityMode }
        : { algorithm: next })
  }

  function changeQuantum(value: string) {
    if (problem.settings.algorithm !== 'round-robin') return
    setQuantum(value)
    setError(null)
    if (!validQuantum(value)) {
      setQuantumError('Enter a whole number of at least 1.')
      return
    }
    setQuantumError(null)
    if (Number(value) === problem.settings.quantum) return
    if (!newProblem({ algorithm: 'round-robin', quantum: Number(value) })) {
      setQuantum(String(problem.settings.quantum))
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (algorithm === 'round-robin' && !validQuantum(quantum)) {
      setQuantumError('Enter a whole number of at least 1.')
      event.currentTarget.querySelector<HTMLInputElement>('#quantum')?.focus()
      return
    }
    newProblem(problem.settings)
  }

  return (
    <main className={styles.workspace}>
      <a className={styles.skipLink} href="#worksheet-title">Skip to practice</a>
      <header className={styles.header}>
        <h1 id="app-title" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>
          <span>Scheduling Algo</span>
        </h1>
        <a
          className={styles.repositoryLink}
          href="https://github.com/K23K-dev/scheduling-algo"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View source on GitHub"
          title="View source on GitHub"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12 .297C5.37.297 0 5.67 0 12.297c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.725-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.73.083-.73 1.205.084 1.838 1.237 1.838 1.237 1.07 1.835 2.807 1.305 3.492.998.108-.776.42-1.305.763-1.605-2.665-.305-5.467-1.334-5.467-5.93 0-1.31.467-2.38 1.235-3.22-.123-.303-.535-1.523.117-3.176 0 0 1.008-.322 3.301 1.23a11.52 11.52 0 0 1 3.003-.404c1.02.005 2.047.138 3.003.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.873.12 3.176.77.84 1.233 1.91 1.233 3.22 0 4.609-2.807 5.622-5.48 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.597 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
        </a>
      </header>

      <div className={styles.setupLayout}>
        <section className={styles.controls} aria-label="Problem settings">
          <form onSubmit={handleSubmit} noValidate>
            <div className={styles.controlFields}>
              <div className={styles.algorithmField}>
                <label htmlFor="algorithm">Algorithm</label>
                <select
                  id="algorithm"
                  value={algorithm}
                  onChange={(event) => {
                    const value = event.target.value
                    if (
                      value === 'fcfs-course' || value === 'round-robin' ||
                      value === 'sjf' || value === 'srtf' || value === 'priority'
                    ) {
                      changeAlgorithm(value)
                    }
                  }}
                >
                  <option value="fcfs-course">FCFS</option>
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
                    onChange={(event) => changeQuantum(event.target.value)}
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
                      if ((value === 'preemptive' || value === 'non-preemptive') && value !== priorityMode) {
                        newProblem({ algorithm: 'priority', mode: value })
                      }
                    }}
                  >
                    <option value="non-preemptive">Non-preemptive</option>
                    <option value="preemptive">Preemptive</option>
                  </select>
                </div>
              ) : null}
              <div className={styles.actions}>
                <button type="submit" name="action" value="new" className={styles.newProblemButton}>
                  <span aria-hidden="true">＋</span> New problem
                </button>
              </div>
            </div>
            {algorithm === 'round-robin' || algorithm === 'priority' ? (
              <div className={styles.controlHelp}>
                {algorithm === 'round-robin' ? <p id="quantum-help">Try a quantum of 2–4 time units.</p> : null}
                {algorithm === 'priority' ? (
                  <p id="priority-help">Smaller numbers mean higher priority.</p>
                ) : null}
              </div>
            ) : null}
            {quantumError ? <p id="quantum-error" className={styles.error} role="alert">{quantumError}</p> : null}
          </form>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        </section>

        <ProcessTable processes={problem.processes} showPriority={problem.settings.algorithm === 'priority'} />
      </div>
      <Worksheet
        key={problem.seed}
        processes={problem.processes}
        history={history}
        onEdit={handleEdit}
        onCheck={handleCheck}
        feedback={feedback}
        checkError={checkError}
        onReveal={handleReveal}
        solutionVisible={solution !== null}
        revealButtonRef={revealButtonRef}
        assisted={assisted}
        helpError={helpError}
        onRetry={resetAttempt}
      />
      {solution ? (
        <SolutionPlayback
          problem={problem}
          solution={solution}
          returnFocusRef={revealButtonRef}
          onClose={() => setSolution(null)}
        />
      ) : null}
    </main>
  )
}
