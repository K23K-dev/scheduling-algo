import { getSchedulingRule, SHARED_SCHEDULING_RULES } from '../scheduling/rules'
import type { ProcessInput, SchedulingSettings } from '../scheduling/types'
import styles from '../App.module.css'

export function ProcessTable({
  processes,
  showPriority = false,
}: {
  readonly processes: readonly ProcessInput[]
  readonly showPriority?: boolean
}) {
  return (
    <section className={styles.panel} aria-labelledby="processes-title">
      <div className={styles.panelHeading}>
        <h2 id="processes-title"><span className={styles.step}>02</span> Processes</h2>
        <span className={styles.smallTag}>CPU → I/O → CPU</span>
      </div>
      <div className={styles.processTableScroll}>
        <table className={styles.processTable} aria-label="Processes">
          <thead>
            <tr>
              <th scope="col">Process</th>
              <th scope="col">Arrival</th>
              <th scope="col">CPU 1</th>
              <th scope="col">I/O</th>
              <th scope="col">CPU 2</th>
              {showPriority ? <th scope="col">Priority</th> : null}
            </tr>
          </thead>
          <tbody>
            {processes.map((process) => (
              <tr key={process.id}>
                <th scope="row"><span className={styles.processBadge} data-process={process.id}>{process.id}</span></th>
                <td className={styles.arrivalValue}>{process.arrival}</td>
                <td>{process.cpu1}</td>
                <td>{process.io}</td>
                <td>{process.cpu2}</td>
                {showPriority ? <td>{process.priority}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.panelFootnote}>
        All processes arrive at time 0. Burst lengths are in time units.
        {showPriority ? ' Smaller priority numbers mean higher priority.' : null}
      </p>
    </section>
  )
}

export function RulesPanel({ settings }: { readonly settings: SchedulingSettings }) {
  const rule = getSchedulingRule(settings)
  return (
    <section className={`${styles.panel} ${styles.rulesPanel}`} aria-labelledby="rules-title">
      <div className={styles.panelHeading}>
        <h2 id="rules-title">Scheduling rules</h2>
        <span className={styles.smallTag}>1 CPU + 1 I/O</span>
      </div>
      <h3 className={styles.ruleTitle}>{rule.label}</h3>
      <dl className={styles.ruleList}>
        <div><dt>Select</dt><dd>{rule.selection}</dd></div>
        <div><dt>Switch</dt><dd>{rule.preemption}</dd></div>
        <div><dt>Order</dt><dd>{rule.tieBreak}</dd></div>
      </dl>
      <details className={styles.sharedRules}>
        <summary>I/O &amp; simultaneous events</summary>
        <ul>{SHARED_SCHEDULING_RULES.map((rule) => <li key={rule}>{rule}</li>)}</ul>
      </details>
    </section>
  )
}
