import { getSchedulingRule, SHARED_SCHEDULING_RULES } from '../scheduling/rules'
import { TIME_BOUNDARIES } from '../scheduling/timeline'
import { TIMELINE_LENGTH, type ProcessInput, type SchedulingSettings } from '../scheduling/types'
import styles from '../App.module.css'

export function ProcessTable({ processes }: { readonly processes: readonly ProcessInput[] }) {
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.panelFootnote}>All processes arrive at time 0. Burst lengths are in time units.</p>
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

const intervals = TIME_BOUNDARIES.slice(0, TIMELINE_LENGTH)
const resources = ['CPU', 'I/O'] as const

export function Worksheet({ processes }: { readonly processes: readonly ProcessInput[] }) {
  return (
    <section className={`${styles.panel} ${styles.worksheet}`} aria-labelledby="worksheet-title">
      <div className={styles.panelHeading}>
        <h2 id="worksheet-title"><span className={styles.step}>03</span> Your timeline</h2>
        <span className={styles.previewTag}>Worksheet preview</span>
      </div>
      <p className={styles.worksheetDescription}>
        Track which process uses each resource. Every block represents one time unit.
      </p>
      <div className={styles.legend} aria-label="Timeline legend">
        {processes.map(({ id }) => <span key={id} className={styles.processBadge} data-process={id}>{id}</span>)}
        <span className={styles.legendItem}><i className={styles.idleSwatch} aria-hidden="true" />Idle</span>
        <span className={styles.legendItem}><i className={styles.emptySwatch} aria-hidden="true">·</i>Unanswered</span>
        <span className={styles.intervalHint}>First block: [0, 1)</span>
      </div>
      <div className={styles.timelineScroll} tabIndex={0} role="region" aria-label="Scrollable CPU and I/O worksheet">
        <table className={styles.timeline} aria-label="CPU and I/O worksheet">
          <colgroup><col className={styles.resourceColumn} /><col span={TIMELINE_LENGTH} /></colgroup>
          <thead>
            <tr>
              <th scope="col" className={styles.axisLabel}>Time</th>
              {intervals.map((time) => (
                <th key={time} scope="col" className={styles.timeBoundary} aria-label={`Time ${time} to ${time + 1}`}>
                  <span>{time}</span>
                  {time === TIMELINE_LENGTH - 1 ? <span className={styles.finalBoundary}>{TIMELINE_LENGTH}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resources.map((resource) => (
              <tr key={resource}>
                <th scope="row" className={styles.resourceLabel}>{resource}</th>
                {intervals.map((time) => (
                  <td
                    key={time}
                    className={`${styles.timelineCell} ${time % 5 === 0 ? styles.majorBoundary : ''}`}
                    aria-label={`${resource}, time ${time} to ${time + 1}: unanswered`}
                  >
                    <span aria-hidden="true">·</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.worksheetFooter}>
        <p><span aria-hidden="true">↔</span> Scroll to explore all 40 blocks.</p>
        <p>Timeline editing is coming next.</p>
      </div>
    </section>
  )
}
