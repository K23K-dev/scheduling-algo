# Scheduling Algo

A web app for practicing CPU scheduling through interactive timelines, based on the scheduling examples in CS2200 Unit 3.

The app generates processes with a first CPU burst, an I/O burst, and a second CPU burst. The learner chooses a scheduling algorithm and fills in two 40-block rows showing which process uses the CPU and the I/O device at each time. Feedback explains the first incorrect scheduling decision and lets the learner revise the attempt.

**Status:** Project scope and implementation plan. The application has not been built yet. The defaults below are proposed product decisions; course-specific behavior is identified explicitly.

## Goals

- Practice scheduling decisions rather than memorize completed diagrams.
- Understand how I/O, ready queues, preemption, and time slices affect execution.
- Generate fresh problems that fit within the same 40-block worksheet.
- Explain mistakes using the actual state of the processes at that time.
- Extend timeline practice into waiting time, turnaround time, and response time calculations.

## Practice flow

1. Select an algorithm and any required settings, such as a round-robin quantum.
2. Generate a problem and read its process table and scheduling rules.
3. Select a process, then click or drag to fill the CPU and I/O timelines.
4. Assign **Idle** where a resource is unused.
5. Select **Check answer** to find the earliest incorrect or unanswered interval.
6. Revise the attempt, request a hint, or reveal the solution step by step.
7. Retry the same problem or generate a new one.

Checking should happen on request. Filling a cell should not immediately reveal whether it is correct.

## Problem model

Each process follows this sequence:

`Arrival -> CPU burst 1 -> I/O -> CPU burst 2 -> Completion`

Use **P1**, **P2**, and so on for process names. Use **CPU 1**, **I/O**, and **CPU 2** for burst columns.

Example input:

| Process | Arrival | CPU 1 | I/O | CPU 2 | Priority |
| --- | --- | --- | --- | --- | --- |
| P1 | 0 | 2 | 3 | 4 | 3 |
| P2 | 0 | 15 | 2 | 6 | 2 |
| P3 | 0 | 6 | 6 | 2 | 1 |

This workload comes from the Unit 3 text and can serve as a fixed practice fixture. Show the priority column only for priority scheduling.

Initial defaults:

- Three processes, all arriving at time 0, in launch order P1, P2, P3.
- One CPU and one shared I/O device.
- Positive integer burst lengths and zero context-switch overhead.
- A process may use only one resource at a time.
- CPU and I/O may run different processes simultaneously.
- I/O runs to completion and uses a FIFO request queue.
- A process doing or waiting for I/O is blocked and cannot use the CPU.
- Every generated problem must finish by time 40 under its selected algorithm and settings.

Later difficulty settings can add staggered arrivals and two to five processes without changing the basic model.

## Scheduling algorithms

| Algorithm | Selection rule | Preemption |
| --- | --- | --- |
| Course FCFS | Choose the ready process with the earliest original launch order | No |
| SJF | Choose the ready process with the shortest next CPU burst | No |
| SRTF | Choose the process with the shortest remaining current CPU burst | When a strictly shorter burst becomes ready |
| Priority | Choose the ready process with the highest priority | Explicitly selectable preemptive or non-preemptive mode |
| Round robin | Rotate through a FIFO ready queue using a fixed quantum | At quantum expiration if the burst is unfinished |

### Course FCFS convention

The Unit 3 examples use **original application launch order**, including after a process returns from I/O. That process keeps its original place in the selection order.

Standard FIFO ready-queue FCFS instead appends a returning process to the back of the ready queue. These rules can produce different answers. The initial app should label its option **FCFS — course launch order** and display that convention beside the problem. A separately named FIFO FCFS mode can be added later.

For staggered arrivals, launch order is arrival time, then process number.

### Other algorithm details

- SJF and SRTF compare the current CPU burst, not future CPU work, I/O duration, or total remaining process time.
- SJF does not preempt a running process when a shorter burst becomes ready.
- SRTF preserves unfinished work after preemption.
- Under SRTF or preemptive priority, a preempted process keeps its remaining burst and re-enters the ready queue at the current timestamp, after newly ready processes. That timestamp becomes its ready-entry time for later selection ties.
- Smaller priority numbers mean higher priority. The selected priority mode must be visible.
- Equal remaining times under SRTF, or equal priorities, do not preempt the running process.
- For SJF, SRTF, and priority selection ties, use earliest entry into the ready queue, then process number.
- Round robin gives a fresh quantum on each dispatch. Blocking or completion ends the turn immediately; unused quantum is discarded.
- A round-robin process that finishes a CPU burst exactly at quantum expiration blocks or completes; it is not requeued as unfinished.

## Time and simultaneous events

Each row has **40 cells**. Cell 1 represents `[0, 1)`, cell 2 represents `[1, 2)`, and cell 40 represents `[39, 40)`. Show time boundaries from 0 through 40.

All resource choices for an interval are made at its starting boundary. Use this deterministic event order:

1. Finish CPU and I/O work ending at time `t`. Mark completed processes and enqueue new I/O requests.
2. Add arrivals and processes returning from I/O to the ready queue. Order simultaneous additions by process number; preserve processes already waiting.
3. Handle quantum expiration or policy-based preemption. For round robin, append an unfinished expired process after the newly ready processes.
4. Start the next queued I/O request if the device is free, and select CPU work according to the algorithm.
5. Execute the interval `[t, t + 1)`.

With zero overhead, a CPU burst can end and I/O can begin at the same boundary. An I/O completion can also make a process eligible for CPU service immediately.

These simultaneous-event and tie-breaking conventions are app defaults. Display them in a compact rules panel so grading never depends on a hidden assumption.

## Timeline interaction

The main screen should contain:

- Algorithm selector, settings, and **New problem**.
- Process table and a compact scheduling-rules panel.
- A process palette with labels and distinct colors, plus **Idle** and **Erase**.
- Aligned CPU and I/O rows with 40 cells each.
- **Undo**, **Redo**, **Clear attempt**, **Check answer**, **Hint**, and **Reveal solution**.
- A feedback area below the timeline.

Interaction requirements:

- Click a cell to assign the selected process; drag to fill a contiguous range in one row.
- Keep empty cells distinct from intentionally assigned Idle cells.
- Provide **Fill remaining empty cells with Idle** to finish unused intervals quickly.
- Treat a drag as one undoable action.
- Keep process labels visible; color alone must not convey the answer.
- Support keyboard navigation and assignment, with readable row, interval, and process labels.
- Use horizontal scrolling on smaller screens rather than compressing 40 cells until they are unreadable.
- Preserve the attempt until the learner explicitly clears it or starts another problem.

Both resources remain Idle after the final process completes. The learner marks this tail as Idle; the app should not reveal the correct completion time before checking.

## Grading and explanations

Build one reference simulator and use its results for generation checks, grading, hints, solution playback, and metrics.

On **Check answer**:

1. Compare both rows in time order.
2. Find the earliest wrong or unanswered cell; if both rows differ at that time, explain them together.
3. Explain what the resource should be doing and why.
4. Let the learner fix that decision before revealing later differences.

An explanation should name the relevant processes, their state, the quantities the algorithm compares, and the event that caused the decision.

Examples of feedback:

- “P1 is still waiting for I/O, so it cannot run on the CPU yet.”
- “P3 has 2 CPU units remaining and P2 has 13. SRTF selects P3.”
- “P2's CPU burst is unfinished, but its quantum has expired. It joins the back of the ready queue.”
- “The I/O device is busy. P3 must wait for the current I/O request to finish.”

Hints should reveal the relevant event or rule before giving the process assignment. Full solution playback should show the CPU, I/O device, queues, and explanation at each boundary.

Keep the learner's attempt available beside or beneath a revealed solution. Mark attempts with a revealed solution as assisted. If a score is added, do not let the Idle padding after completion dominate it.

## Random problem generation

Generate a candidate workload, solve it, and keep it only if it satisfies the problem constraints.

- Store a random seed, algorithm, settings, and generator/rules version for reproducibility.
- Retry must use the same workload; New problem should generate a new seed.
- Use bounded generation attempts, followed by a known valid fallback.
- Reject workloads that finish after time 40. Never clip the timeline or shorten bursts after solving.
- Aim for problems that use much of the timeline while leaving room for variation.
- Include varied cases: overlapping CPU/I/O, I/O contention, idle CPU intervals, and meaningful preemption or quantum expiration.
- Do not require every problem to contain every teaching case. Use difficulty settings or scenario categories later.
- When changing algorithms or quantum, revalidate the workload. If it no longer fits, explain that and generate a new problem.

The initial generator can use three processes, CPU bursts of 1–8 units, I/O bursts of 1–5 units, and round-robin quanta of 2–4 units. These are candidate ranges, not a guarantee that every sample fits.

## Scheduling metrics

Add a second exercise after the learner completes the timeline:

| Metric | Definition |
| --- | --- |
| Turnaround time | Completion time minus arrival time |
| Response time | First CPU start time minus arrival time |
| CPU ready-queue waiting | Time ready to run but not using the CPU |
| Total queue waiting | Turnaround minus both CPU bursts minus active I/O time |
| CPU utilization | CPU busy time divided by elapsed time from 0 to final completion |
| Throughput | Number of completed processes divided by elapsed time from 0 to final completion |

**CPU ready-queue waiting and total queue waiting are different.** Total queue waiting includes waiting for the shared I/O device; CPU ready-queue waiting excludes all blocked time.

Show per-process values and averages where appropriate. Use actual completion time for utilization and throughput, excluding the display's trailing Idle padding. Specify rounding to two decimal places for requested decimal answers.

## Proposed technical approach

Build a browser-only application with **React, TypeScript, and Vite**. The initial version needs no accounts, server, database, or external AI service. Vite provides a React/TypeScript starter and a static build workflow; see the [official Vite guide](https://vite.dev/guide/).

Separate scheduling logic from the interface:

| Module | Responsibility |
| --- | --- |
| Problem model | Process inputs, algorithm settings, seed, and rules version |
| Simulator | Resource state, queues, algorithm decisions, and boundary events |
| Generator | Reproducible workloads and acceptance checks |
| Grader | Compare attempts and identify the first divergence |
| Explanations | Turn recorded events and decisions into readable feedback |
| Metrics | Derive timings from the simulated state history |
| Practice interface | Controls, timeline editing, feedback, and solution playback |
| Persistence | Save the current problem and attempt in browser storage |

The simulator should be a pure function: the same problem and rules produce the same timelines and event history. Randomness belongs in the generator.

Keep editable answers separate from the reference solution. Record enough state at each boundary to explain a choice without rerunning a different interpretation of the algorithm.

Once the application exists, add verified installation, development, test, and build commands here.

## Build phases

### Phase 1 — First playable version

- Implement the process model, event ordering, course FCFS, and round robin.
- Validate the engine with small hand-calculated examples.
- Build the process table and editable 40-cell CPU/I/O rows.
- Add seeded generation, Idle/Erase controls, undo/redo, and checking.
- Explain the earliest mistake and support retrying the same problem.

**Exit condition:** A learner can generate, solve, check, and retry a complete problem for both algorithms.

### Phase 2 — Complete algorithm practice

- Add SJF, SRTF, and both priority modes.
- Add rules panels, progressive hints, and solution playback.
- Add keyboard support and verify narrow-screen behavior.
- Save and restore the current attempt locally.
- Expand generated scenarios to exercise algorithm-specific decisions.

**Exit condition:** Every listed algorithm supports the full practice loop with consistent grading.

### Phase 3 — Deeper practice

- Add metric questions and explanations.
- Add difficulty settings, staggered arrivals, and configurable process counts.
- Add custom workloads and reproducible problem sharing.
- Add a separately labeled FIFO FCFS mode.
- Add comparison mode for workloads that fit within 40 blocks under every selected algorithm.

## Validation

Use independent, hand-calculated fixtures to validate the simulator. Reusing the simulator to generate and grade problems is necessary for consistency, but does not prove it is correct.

Essential cases:

- CPU and I/O run different processes at the same time.
- CPU remains Idle when every unfinished process is blocked.
- Multiple requests compete for the shared I/O device.
- Returning from I/O changes course FCFS and FIFO FCFS ordering differently.
- A shorter burst arriving during execution preempts under SRTF but not SJF.
- A higher-priority process preempts only in preemptive priority mode.
- Equal SRTF lengths or priorities retain the current process.
- CPU completion coincides with round-robin quantum expiration.
- Arrival, I/O completion, and quantum expiration occur at the same boundary.
- A valid workload completes exactly at time 40.
- Total queue waiting differs from CPU ready-queue waiting because of I/O contention.
- The same seed and settings reproduce the same problem.

Also check invariants: no process uses CPU and I/O simultaneously, no blocked process uses the CPU, executed durations equal the input bursts, no work starts before arrival, and every process completes exactly once.

Verify the full interface flow from generation through editing, checking, correction, reveal, retry, and local restoration.

## Outside the initial scope

- Accounts, cloud synchronization, leaderboards, or multiplayer.
- Multiple CPUs or multiple I/O devices.
- Context-switch costs, priority aging, or arbitrary sequences of many bursts.
- A real operating-system scheduler or performance benchmark.
- Automatic ingestion of course notes.

The first release is successful when a student can repeatedly practice the Unit 3 scheduling problems and understand a wrong decision without consulting a completed diagram.
