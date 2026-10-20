import { useEffect, useRef } from 'react'
import type { HintLevel, HintResult } from '../scheduling/hints'
import type { Resource } from '../scheduling/types'
import styles from './HintPanel.module.css'

export function HintPanel({
  hint,
  error,
  onHint,
  onEditCell,
}: {
  readonly hint: HintResult | null
  readonly error: string | null
  readonly onHint: (level: HintLevel) => void
  readonly onEditCell: (resource: Resource, time: number) => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    // Requested help stays reachable when its progression button disappears.
    if (hint) headingRef.current?.focus()
    else if (error) errorRef.current?.focus()
  }, [hint, error])

  return (
    <div className={styles.hintArea}>
      <div aria-live="polite" aria-atomic="true">
        {hint?.status === 'correct' ? (
          <section className={styles.panel} aria-labelledby="hint-title">
            <h3 id="hint-title" ref={headingRef} tabIndex={-1}>Your timeline is already correct</h3>
            <p>There are no intervals left to work through. You can retry this problem or start a new one.</p>
          </section>
        ) : hint?.status === 'hint' ? (
          <section className={styles.panel} aria-labelledby="hint-title">
            <p className={styles.eyebrow}>
              {hint.level === 1 ? 'THE RULE' : hint.level === 2 ? 'WHAT TO CONSIDER' : 'ASSIGNMENT REVEALED'}
            </p>
            <h3 id="hint-title" ref={headingRef} tabIndex={-1}>Hint {hint.level} of 3 · time {hint.time}–{hint.time + 1}</h3>
            {hint.messages.map(({ resource, text }) => (
              <div className={styles.resource} key={resource}>
                <h4>{resource === 'cpu' ? 'CPU' : 'I/O'}</h4>
                <p>{text}</p>
                <button type="button" onClick={() => onEditCell(resource, hint.time)}>
                  Focus {resource === 'cpu' ? 'CPU' : 'I/O'} at time {hint.time}
                </button>
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
      {error ? <p className={styles.error} role="alert" ref={errorRef} tabIndex={-1}>{error}</p> : null}
    </div>
  )
}
