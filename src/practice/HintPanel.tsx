import type { HintLevel, HintResult } from '../scheduling/hints'
import styles from './HintPanel.module.css'

export function HintPanel({
  hint,
  error,
  onHint,
}: {
  readonly hint: HintResult | null
  readonly error: string | null
  readonly onHint: (level: HintLevel) => void
}) {
  return (
    <div className={styles.hintArea}>
      <div aria-live="polite" aria-atomic="true">
        {hint?.status === 'correct' ? (
          <section className={styles.panel} aria-labelledby="hint-title">
            <h3 id="hint-title">Your timeline is already correct</h3>
            <p>There are no intervals left to work through. You can retry this problem or start a new one.</p>
          </section>
        ) : hint?.status === 'hint' ? (
          <section className={styles.panel} aria-labelledby="hint-title">
            <p className={styles.eyebrow}>
              {hint.level === 1 ? 'THE RULE' : hint.level === 2 ? 'WHAT TO CONSIDER' : 'ASSIGNMENT REVEALED'}
            </p>
            <h3 id="hint-title">Hint {hint.level} of 3 · time {hint.time}–{hint.time + 1}</h3>
            {hint.messages.map(({ resource, text }) => (
              <div className={styles.resource} key={resource}>
                <h4>{resource === 'cpu' ? 'CPU' : 'I/O'}</h4>
                <p>{text}</p>
              </div>
            ))}
            {hint.level < 3 ? (
              <button type="button" onClick={() => onHint(hint.level === 1 ? 2 : 3)}>
                {hint.level === 1 ? 'More detail' : 'Show this assignment'}
              </button>
            ) : <p className={styles.note}>Your attempt is unchanged. Edit it when you’re ready.</p>}
          </section>
        ) : null}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  )
}
