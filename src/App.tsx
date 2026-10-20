import { useReducer, useState, type FormEvent } from 'react'
import { createProblemSeed, generateProblem } from './scheduling/generator'
import { getSchedulingRule } from './scheduling/rules'
import type { Problem, SchedulingSettings } from './scheduling/types'
import { updateProblemSettings } from './practice/settings'
import { ProcessTable, RulesPanel } from './practice/Workspace'
import { Worksheet } from './practice/Worksheet'
import { ReplaceProblemDialog } from './practice/ReplaceProblemDialog'
import { attemptReducer, createAttemptHistory } from './practice/attempt'
import styles from './App.module.css'

type AvailableAlgorithm = 'fcfs-course' | 'round-robin'

export default function App() {
  const [problem, setProblem] = useState(() =>
    generateProblem(createProblemSeed(), { algorithm: 'fcfs-course' }),
  )
  const [algorithm, setAlgorithm] = useState<AvailableAlgorithm>('fcfs-course')
  const [quantum, setQuantum] = useState('2')
  const [quantumError, setQuantumError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('Problem ready. All three processes arrive at time 0.')
  const [history, editAttempt] = useReducer(attemptReducer, undefined, createAttemptHistory)
  const [replacement, setReplacement] = useState<Problem | null>(null)
  const activeRule = getSchedulingRule(problem.settings)
  const pendingSettings = algorithm !== problem.settings.algorithm ||
    (problem.settings.algorithm === 'round-robin' && Number(quantum) !== problem.settings.quantum)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
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
      : { algorithm }
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')

    try {
      if (action === 'new') {
        const next = generateProblem(createProblemSeed(problem.seed), settings)
        setProblem(next)
        editAttempt({ type: 'reset' })
        setNotice('New problem ready. Read the process table to get started.')
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
        if (updated.replaced) editAttempt({ type: 'reset' })
        setNotice(updated.replaced
          ? 'The previous workload would exceed 40 blocks with these settings. A new problem is ready.'
          : 'Settings applied. The same processes and burst lengths are ready to use.')
      } else {
        setNotice('These settings are already applied. Your current problem is unchanged.')
      }
    } catch {
      setError('This problem could not be prepared. Please try again.')
    }
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <a href="#app-title" className={styles.brand} aria-label="Scheduling Algo home">
          <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>
          <span>Scheduling Algo</span>
        </a>
        <span className={styles.course}>CS2200 <span aria-hidden="true">/</span> UNIT 3</span>
      </header>

      <section className={styles.introduction} aria-labelledby="app-title">
        <div>
          <p className={styles.eyebrow}>THE SCHEDULING WORKBENCH</p>
          <h1 id="app-title">Scheduling Algo</h1>
          <p className={styles.description}>One CPU. Three processes. What runs next?</p>
        </div>
        <div className={styles.model} aria-label="Each process runs CPU 1, then I/O, then CPU 2">
          <span>CPU 1</span><b aria-hidden="true">→</b><span>I/O</span><b aria-hidden="true">→</b><span>CPU 2</span>
        </div>
      </section>

      <section className={styles.controls} aria-labelledby="settings-title">
        <div className={styles.sectionHeading}>
          <h2 id="settings-title"><span className={styles.step}>01</span> Set up your problem</h2>
          <span className={styles.muted}>3 processes · 40 time units</span>
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.controlFields}>
            <div className={styles.algorithmField}>
              <label htmlFor="algorithm">Algorithm</label>
              <select
                id="algorithm"
                value={algorithm}
                aria-describedby="settings-help"
                onChange={(event) => {
                  const value = event.target.value
                  if (value === 'fcfs-course' || value === 'round-robin') {
                    setAlgorithm(value)
                    setQuantumError(null)
                    setError(null)
                  }
                }}
              >
                <option value="fcfs-course">FCFS — course launch order</option>
                <option value="round-robin">Round robin</option>
                <option value="sjf" disabled>SJF — coming soon</option>
                <option value="srtf" disabled>SRTF — coming soon</option>
                <option value="priority" disabled>Priority — coming soon</option>
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
            <div className={styles.actions}>
              <button type="submit" name="action" value="apply" className={styles.secondaryButton}>
                Apply settings
              </button>
              <button type="submit" name="action" value="new" className={styles.primaryButton}>
                <span aria-hidden="true">＋</span> New problem
              </button>
            </div>
          </div>
          <div className={styles.controlHelp}>
            <p id="settings-help">
              {pendingSettings
                ? 'Changes are pending. Apply settings to reuse this workload, or start a new problem.'
                : 'Apply settings to reuse this workload. New problem generates a fresh one.'}
            </p>
            {algorithm === 'round-robin' ? <p id="quantum-help">Try a quantum of 2–4 time units.</p> : null}
          </div>
          {quantumError ? <p id="quantum-error" className={styles.error} role="alert">{quantumError}</p> : null}
        </form>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <p className={styles.notice} role="status"><span aria-hidden="true" />{notice}</p>
      </section>

      <div className={styles.problemHeader}>
        <p><span className={styles.liveDot} aria-hidden="true" /> Current problem <b>{activeRule.label}</b></p>
        <span className={styles.seed}>Seed <span>{problem.seed}</span></span>
      </div>
      <div className={styles.problemLayout}>
        <ProcessTable processes={problem.processes} />
        <RulesPanel settings={problem.settings} />
      </div>
      <Worksheet
        key={problem.seed}
        processes={problem.processes}
        history={history}
        onEdit={editAttempt}
      />
      {replacement ? (
        <ReplaceProblemDialog
          onCancel={() => {
            setReplacement(null)
            setNotice('Current problem and attempt kept. The selected settings have not been applied.')
          }}
          onConfirm={() => {
            setProblem(replacement)
            editAttempt({ type: 'reset' })
            setReplacement(null)
            setNotice('The previous workload would exceed 40 blocks with these settings. A new problem is ready.')
          }}
        />
      ) : null}

      <footer className={styles.footer}>
        <span>Understand the decision. Build the timeline.</span>
        <a href="https://github.com/K23K-dev/scheduling-algo">
          View the project <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </main>
  )
}
