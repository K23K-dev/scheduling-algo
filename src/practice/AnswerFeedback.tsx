import type { GradeResult } from '../scheduling/grader'
import type { AttemptCell, Resource } from '../scheduling/types'
import styles from './AnswerFeedback.module.css'

interface AnswerFeedbackProps {
  readonly result: GradeResult | null
  readonly error: string | null
  readonly onEditCell: (resource: Resource, time: number) => void
}

function answerLabel(value: AttemptCell): string {
  return value === null ? 'Unanswered' : value === 'idle' ? 'Idle' : value
}

export function AnswerFeedback({ result, error, onEditCell }: AnswerFeedbackProps) {
  return (
    <div className={styles.feedbackArea}>
      <div aria-live="polite" aria-atomic="true">
        {result?.status === 'correct' ? (
          <section className={`${styles.feedback} ${styles.success}`} aria-labelledby="feedback-title">
            <p className={styles.eyebrow}>ANSWER CHECK</p>
            <h3 id="feedback-title">Timeline correct</h3>
            <p>Both rows match, including the Idle intervals. You can keep editing, clear your attempt to retry, or start a new problem.</p>
          </section>
        ) : result?.status === 'needs-correction' ? (
          <section className={styles.feedback} aria-labelledby="feedback-title">
            <p className={styles.eyebrow}>FIRST INTERVAL TO REVIEW</p>
            <h3 id="feedback-title">Review time {result.time}–{result.time + 1}</h3>
            <p className={styles.introduction}>
              {result.time === 0
                ? 'Start with this interval, then check again.'
                : `Both rows are correct before time ${result.time}. Focus on this interval, then check again.`}
            </p>
            <div className={styles.issues}>
              {result.issues.map((issue) => {
                const label = issue.resource === 'cpu' ? 'CPU' : 'I/O'
                return (
                  <article key={issue.resource} className={styles.issue} id={`feedback-${issue.resource}`}>
                    <h4>{label}</h4>
                    <div className={styles.answers}>
                      <span>Your answer: <b>{answerLabel(issue.actual)}</b></span>
                      <span>Expected: <b>{answerLabel(issue.expected)}</b></span>
                    </div>
                    <p>{issue.explanation}</p>
                    <button type="button" onClick={() => onEditCell(issue.resource, result.time)}>
                      Edit {label} at time {result.time} <span aria-hidden="true">↗</span>
                    </button>
                  </article>
                )
              })}
            </div>
            <p className={styles.nextStep}>Revise your timeline, then check again. Your answers stay editable.</p>
          </section>
        ) : null}
      </div>
      {error ? <p role="alert" className={styles.checkError}>{error}</p> : null}
    </div>
  )
}
