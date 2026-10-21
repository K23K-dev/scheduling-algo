# Scheduling Algo

A web app for practicing CPU scheduling through interactive timelines, based on the scheduling examples in CS2200 Unit 3.

The app generates processes with a first CPU burst, an I/O burst, and a second CPU burst. The learner chooses a scheduling algorithm and fills in two 40-block rows showing which process uses the CPU and the I/O device at each time. Feedback explains the first incorrect scheduling decision and lets the learner revise the attempt.

**Status:** All five algorithms support generated problems, scheduling rules, editable 40-block CPU/I/O timelines with undo/redo, answer checking, progressive hints, and solution playback. Priority supports both preemptive and non-preemptive modes. Keyboard navigation and touch layouts are supported. Practice stays in the current page session; browser storage is outside the release scope. Course-specific behavior and app defaults are identified below.

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

This workload comes from the Unit 3 text. Under the course FCFS rules below, it finishes at time **41**, so it is a reference input and an overflow test, not a valid 40-cell FCFS practice problem. Keep its burst lengths unchanged. Show the priority column only for priority scheduling.

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
- **Undo**, **Redo**, **Clear attempt**, **Check answer**, **Hint**, **Reveal solution**, and **Retry same problem**.
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

Generator version 1 uses three processes arriving at time 0, CPU bursts of 1–8 units, and I/O bursts of 1–5 units. It accepts schedules finishing between times 28 and 40, inclusive. These candidate ranges do not guarantee that every sample fits. Priority problems also include seeded priorities from 1–5, allowing equal priorities. Round-robin quanta of 2–4 units are suggested practice settings; the generator accepts any positive safe integer quantum.

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

The simulator should be a pure function: the same problem and rules produce the same timelines and event history. Randomness belongs in the generator.

Keep editable answers separate from the reference solution. Record enough state at each boundary to explain a choice without rerunning a different interpretation of the algorithm.

### Scheduling model

The React-independent modules in `src/scheduling/` define the scheduling contracts:

- `Problem` holds process inputs, algorithm settings, an unsigned 32-bit seed, and rules/generator versions. `parseProblem` accepts unknown data and returns either a detached, validated problem or errors with field paths. It requires positive integer bursts and quantum, nonnegative integer arrivals, and unique IDs such as P1 and P2. Numeric fields must be safe integers. Priority can be any safe integer, with smaller values ranking higher; it is required only for priority scheduling.
- Structural validation deliberately allows small fixtures, staggered arrivals, and values outside the generator's ranges. It does **not** establish that a workload finishes by time 40; the simulator checks that separately. Unsupported versions and irrelevant settings, such as a quantum on SJF, are rejected.
- An `Attempt` contains only editable CPU/I/O rows: `null` means unanswered, `"idle"` means intentionally Idle, and a process ID means an assignment. `parseAttempt` checks two 40-cell rows and valid process references, without grading the learner's choices. Reference timelines cannot contain unanswered cells.
- Process states distinguish not arrived, ready, running, waiting for I/O, performing I/O, and completed. Boundary snapshots retain process work, ordered queues, resource assignments, and decision events. Snapshots at times 0–39 describe the state after dispatch and before execution; a terminal snapshot at 40 records final bookkeeping without another interval.
- Rule helpers describe boundary phases, numeric process ordering, launch-order and ready-entry tie-breaks, strict preemption, and completion-before-quantum-expiration behavior. Ready-entry timestamps and actual FIFO queue positions remain separate.

### Simulator

`simulate(problem)` in `src/scheduling/simulator.ts` supports **FCFS — course launch order**, **round robin**, **SJF**, **SRTF**, and **priority** in both modes. It validates the problem, preserves its inputs, and returns the same result on repeated calls. Invalid input, including unknown algorithms or missing priorities for priority scheduling, throws a `TypeError`.

The result contains two 40-cell reference timelines and 41 independent boundary snapshots, including process states, queue order, and decision events. Work completing at a boundary is processed before new dispatches, so CPU and I/O transitions have no extra delay. Course FCFS selects by original launch order and runs each CPU burst to completion. The shared I/O device serves requests in FIFO order and always runs them to completion.

Round robin takes the head of the ready queue and gives it a fresh quantum on every dispatch. CPU execution decreases both its remaining burst and quantum. An unfinished process whose quantum expires joins the queue after existing waiters and this boundary's arrivals/I/O returns, retaining its remaining work and receiving a new ready-entry timestamp. A process can immediately receive another full quantum if nobody else is ready. Blocking or completion discards unused quantum; a CPU burst ending exactly at expiration blocks or completes without being requeued. A new arrival or I/O return alone does not interrupt a running turn.

SJF compares only the current burst and lets it finish. SRTF preempts only for a strictly shorter remaining current burst. Priority compares smaller numbers first and interrupts unfinished work only in preemptive mode for a strictly higher priority. Selection ties use ready-entry time, then numeric process ID; equal lengths or priorities never interrupt a running process. Preemption records the running process and challenger, preserves unfinished work, and resets the interrupted process's ready-entry time to the current boundary.

A completed workload returns `status: "complete"` with its actual `completionTime`; trailing timeline cells are Idle. Completion exactly at 40 is valid. Unfinished work returns `status: "limit-reached"` with `completionTime: null` and its remaining work recorded at boundary 40. The engine never executes an extra interval or changes burst lengths to make a workload fit. The generator rejects these unfinished workloads.

Hand-calculated tests cover overlap, I/O contention, blocked CPU idleness, launch-order selection after I/O, round-robin rotation, fresh quanta, current-burst comparisons, both priority modes, strict preemption, selection ties, simultaneous events, and the worksheet limit. Additional invariant tests verify resource exclusivity, conserved work, FIFO queues, time-slice accounting, policy decisions, and reproducible, independent history snapshots across varied workloads. Boundary 40 still performs completion and queue bookkeeping, including unfinished quantum expiration and policy preemption, without dispatching or executing more work.

### Generator

`generateProblem(seed, settings)` in `src/scheduling/generator.ts` returns a detached `Problem` for any of the five algorithms. It validates the unsigned 32-bit seed and settings, then uses a local seeded random stream to sample P1, P2, and P3 in order, drawing CPU 1, I/O, then CPU 2 for each process. The same seed, settings, and versions reproduce the same workload, regardless of other generation calls.

Priority uses an independent Mulberry32 stream seeded by `(seed ^ 0x9e3779b9) >>> 0`, drawing one value from 1–5 per process in numeric ID order. This stream restarts for each candidate and fallback, so rejected candidates and changes of priority mode do not change the priority values. Existing FCFS and round-robin version-1 outputs and burst draws remain unchanged. The new policies extend the supported settings without changing those existing contracts.

Every candidate is checked by `simulate`. The first schedule completing in 28–40 intervals is accepted; rejected workloads are discarded without changing their bursts. After 100 rejected candidates, the generator checks and returns a fixed workload with 28 units of CPU work and 9 units of I/O work, adding the same seeded priorities when needed. Since all processes arrive at zero and every supported policy keeps working whenever work is available, that fallback finishes between times 28 and 37 under either priority mode or any valid quantum. A failed fallback check throws instead of returning an invalid worksheet.

`createProblemSeed(previousSeed?)` draws a new unsigned 32-bit seed and avoids repeating the supplied current seed. Use it for **New problem**; **Retry** should retain the existing `Problem`. Store the actual processes along with their seed, settings, and versions. Changes to the random stream, sample order, ranges, acceptance rules, attempt limit, or fallback require a generator-version change. When changing settings, the practice workspace first simulates the existing workload under those settings, explaining any overflow and generating a replacement when necessary.

Generator tests cover fixed-seed reproduction, invalid inputs, completion exactly at 40, whole-candidate rejection, bounded fallback, independent returned objects, and stable priorities. Tests across seeded worksheets for all policies check that all original work fits. The course FCFS and round-robin sample sets also verify CPU/I/O overlap, I/O contention, blocked CPU idle time, and meaningful quantum expiration.

### Practice workspace

The app opens a generated course FCFS problem. Choose any algorithm, a positive whole-number quantum for round robin, or an explicit mode for priority. Priority initially uses non-preemptive mode. **Apply settings** keeps the existing processes, seed, answers, and undo history if the workload still finishes by time 40. If it overflows, the app explains the replacement and asks before discarding any existing or undoable answers. **New problem** uses a fresh seed with the selected settings and resets the attempt and its history. Controls remain a draft until either action; the process table and rules continue to describe the active problem. Invalid quantum input and failed generation leave that problem and attempt intact.

The process table shows arrival, CPU 1, I/O, and CPU 2 values, plus a Priority column only when priority is the applied algorithm. Smaller numbers mean higher priority. Switching an existing workload to priority adds any missing values from its seed without changing its bursts. Existing priority values are retained across mode changes and switches to other algorithms. Rules show the active scheduling convention and priority mode, with expandable I/O and simultaneous-event details.

The worksheet starts with 40 unanswered cells per resource and boundary labels 0–40. Select a process, **Idle**, or **Erase**, then click a block or drag through a contiguous range in one row. Dragging previews the range until release, including when dragging backward; reversing toward the starting block restores cells outside the smaller range. A completed drag is one undoable edit. Escape, pointer cancellation, loss of pointer capture, or the window losing focus cancels the preview. On touch screens, tap to assign and swipe to scroll without painting.

**Fill remaining empty cells with Idle** preserves existing assignments. **Clear attempt** erases both rows. Each is a single undoable edit. Undo/redo retains up to 100 changes, ignores no-op assignments, and drops redo history only after a changed edit. History never crosses into a new problem. The immutable editing reducer is in `src/practice/attempt.ts`; answers are independent of the reference simulator, and even incorrect assignments are allowed without feedback.

Keyboard users can choose **Skip to practice** at the start of the page. Tab moves through the tools and enters the timeline at its last focused cell; the other 79 cells do not add tab stops. Arrow keys move between cells, Home/End jump to the row's first/last block, Enter/Space assign the selected tool, and Delete/Backspace erase. **1/2/3** select the corresponding process, **I** selects Idle, and **E** selects Erase without changing any answers. The selected tool is shown and announced. Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. Shortcuts apply only while focus is inside the worksheet and do not intercept text entry or composition.

Focused cells scroll into view clear of the sticky resource labels. Every cell exposes its resource, interval, and assignment as an accessible label. Small screens and touch devices use timeline cells at least 44px wide and controls at least 44px tall; horizontal scrolling keeps the full 40 intervals readable. Headers and action groups wrap, and process-input and playback-state tables have labeled, keyboard-accessible scroll areas. Mobile input text stays at least 16px. The filled-cell count does not indicate correctness. Reloading or closing the page ends the attempt; local saving is intentionally omitted.

**Check answer** compares the current attempt against the applied settings, even while other settings are still a draft. It reports only the earliest wrong or unanswered interval, grouping CPU and I/O feedback when both need attention there. Each explanation names the expected assignment and explains the decision using the simulator's recorded events, process states, remaining work, and dispatch candidates. Unanswered cells remain different from intentional Idle cells, including the unused tail. A complete matching attempt receives a success message.

The reported cells have an outline and a review marker, with accessible links to their explanations. **Edit CPU/I/O at time …** scrolls to and focuses that cell without changing its assignment. Checking never fills answers or changes undo history. Editing, undoing, redoing, clearing, or filling hides the previous result until another explicit check. Applying changed settings or starting a new problem also clears feedback; draft settings, invalid submissions, and canceled replacements preserve it.

The pure grader is in `src/scheduling/grader.ts`. It validates attempts, uses the shared reference simulator, and returns only success or the issues at the first differing interval. It rejects invalid inputs and workloads that exceed 40 intervals. Tests cover chronological comparison across both rows, blank versus Idle, original launch order, round-robin queue ordering and expiration, shortest-burst and priority comparisons, selection ties, preemption and equal-value continuation, simultaneous completion, I/O contention, and the full check–correct–recheck interface flow for every policy.

### Hints and solution playback

**Hint** starts at the earliest wrong or unanswered interval, covering both resources when necessary. It reveals help in three stages:

1. The applicable scheduling rule.
2. **More detail** shows the relevant boundary events, candidates and remaining work, or I/O request order, without explicitly choosing an assignment.
3. **Show this assignment** names the answer and explains why it runs.

The first two stages leave the attempt unassisted. Revealing an assignment or the full solution marks it **Assisted attempt**. Each requested hint receives keyboard focus, and **Focus CPU/I/O at time …** jumps to the relevant cell without editing it. Editing clears the current hint so the next request considers the revised answers. Hints never fill cells or change undo history; a correct attempt receives a success message instead. The pure `getHint` helper in `src/scheduling/hints.ts` uses the grader's earliest mismatch and the simulator's recorded decisions, sharing explanations with checking and playback.

**Reveal solution** opens a separate, read-only reference timeline beneath the editable worksheet. Playback starts paused. Use **Previous step**, **Next step**, the **Playback time** slider, **Back to start**, or **Go to end** to inspect any boundary. **Play** advances once per second; navigation, hiding the solution, leaving the window, or hiding the tab pauses it. It stops at time 40.

Each interval shows CPU and I/O assignments with explanations, queues after dispatch, and process states with remaining CPU/I/O work. Round robin includes remaining quantum; priority includes process priorities. The timeline scrolls horizontally to follow the selected boundary. At time 40, playback shows final bookkeeping and events without inventing a 41st interval.

The learner's answers and undo/redo remain available while the solution is open. Revealing playback moves focus to its heading. **Hide solution** closes playback, returns focus to **Reveal solution**, and retains the assisted label. Endpoint navigation keeps keyboard focus on the time slider when its button becomes disabled. Clearing answers also retains that label because it is undoable. Applying different settings closes playback and clears hints; if the workload stays the same, answers, history, and assisted status remain. Draft settings, invalid submissions, and canceled replacements preserve the current help.

**Retry same problem** keeps the seed, processes, and applied settings while clearing answers, history, hints, playback, and the assisted label. **New problem** or an accepted replacement also resets this practice state. Tests cover progressive disclosure, all policies, terminal boundary 40, playback timers and cleanup, assistance tracking, retry, settings changes, and failure recovery.

## Local development

Use the Node.js version pinned in [`.nvmrc`](.nvmrc) (24.22.0) and its bundled npm. CI reads the same version file. If you use nvm, run `nvm install` and `nvm use` in this directory first.

From the repository root:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Generate a workload, choose an assignment tool, and fill the CPU/I/O timelines. Select **Check answer**, revise the earliest interval that needs attention, and check again.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run lint` | Check code with Oxlint |
| `npm run typecheck` | Check TypeScript types |
| `npm test` | Run Vitest tests once |
| `npm run test:watch` | Rerun tests as files change |
| `npm run build` | Check types and create the production build in `dist/` |
| `npm run preview` | Serve the existing production build locally |

Run `npm run build` before `npm run preview`. Component tests use React Testing Library and jsdom.

GitHub Actions runs installation, linting, type checking, tests, and a production build for pull requests and pushes to `main`. Successful builds on `main` deploy to GitHub Pages. Pull requests run the checks without publishing.

## GitHub Pages deployment

The site is configured for [k23k-dev.github.io/scheduling-algo](https://k23k-dev.github.io/scheduling-algo/). Vite's base path is `/scheduling-algo/`, so built assets load from the repository's Pages path. Local development and preview use that same path.

One-time setup:

1. Open the repository's **Settings → Pages → Build and deployment**.
2. Set **Source** to **GitHub Actions**.
3. Commit and push the deployment configuration to `main`.

The **Checks and Pages** workflow installs dependencies, runs all checks, builds `dist`, and uploads it as a Pages artifact. Its deployment job uses the `github-pages` environment and the built-in GitHub token; no personal token or deployment secret is required. Deployments are serialized so an active publish is not canceled by a newer one. Later pushes to `main` publish automatically after their checks pass.

To redeploy the current `main` without another commit, open **Actions → Checks and Pages → Run workflow** and select `main`. Check the deployment job and open its environment URL to verify the published site.

For a local production preview, run `npm run build`, then `npm run preview`, and open the printed `/scheduling-algo/` URL. If the repository is renamed or a custom domain is introduced, update Vite's base path before publishing again. See the [Vite Pages guide](https://vite.dev/guide/static-deploy.html#github-pages) and [GitHub's custom workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

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

Verify the full interface flow from generation through editing, checking, correction, reveal, and retry, including keyboard focus and narrow-screen scrolling.

## Outside the initial scope

- Accounts, cloud synchronization, leaderboards, or multiplayer.
- Saving or restoring attempts across page reloads.
- Multiple CPUs or multiple I/O devices.
- Context-switch costs, priority aging, or arbitrary sequences of many bursts.
- A real operating-system scheduler or performance benchmark.
- Automatic ingestion of course notes.

The first release is successful when a student can repeatedly practice the Unit 3 scheduling problems and understand a wrong decision without consulting a completed diagram.
