# Trajectory — The Simulator

> The question is not "what should I do?"
> It is "which available action most improves my future trajectory?"

`ARCHITECTURE.md` specifies the state engine — what is true now. This specifies
the simulator — what is likely next, and how today's action bends it.

---

## 1. What changes

The current engine ranks by a scalar heuristic:

```
leverage(a) = (impact × urgency × unblock) / effort
```

That scores an action against the *present*. It cannot answer "and then what?",
which means it cannot distinguish an action that looks good today from one that
compounds. Under the reframe:

```
value(a) = E[V(trajectory | do(a))] − E[V(trajectory | do(∅))]
```

The expected improvement in future trajectory value from taking action `a`
versus doing nothing. This is a **counterfactual**, and it forces four things
into existence:

| # | Component | Answers |
|---|---|---|
| 1 | **Forward model** | How does state evolve if I do nothing? |
| 2 | **Intervention model** | How does action `a` change that evolution? |
| 3 | **Value function** | What makes one future better than another? |
| 4 | **Propagation** | How does uncertainty compound over the horizon? |

The consequence worth stating up front: **a recommendation stops being a number
and becomes a distribution.** "Leverage 1.105" is replaced by "+£18k expected,
64% chance of improving, 10th percentile −£4k." Everything downstream — the
dashboard, the brief, the chat answer — has to carry uncertainty rather than
hide it.

---

## 2. Simulate the substrate, not the state

The important structural decision.

Derived state is already a pure function of substrate (`ARCHITECTURE.md` §2). So
the simulator does **not** model how `trajectory` or `riskLevel` evolve — it
evolves the *substrate* and re-derives state at each step using the engine that
already exists:

```
substrate(t=0) ──stochastic dynamics──▶ substrate(t=1) ──▶ … ──▶ substrate(t=H)
     │                                       │                        │
     ▼ runEngine()                           ▼                        ▼
  state(0)                                state(1)                 state(H)
```

Three things fall out of this for free:

- **No duplicated logic.** Momentum, bottleneck and risk are computed by the same
  code in simulation as in reality. They cannot drift apart.
- **The value function reads derived state**, so "risk" in a simulated future
  means exactly what it means today.
- **Simulated futures are inspectable.** A projected state is a real state object
  and can be rendered by any existing projection.

The existing engine becomes the *observation function* of the simulator.

---

## 3. The dynamics

Five stochastic processes. Each is a per-step transition on substrate, with
parameters that start as priors and are updated from observation (§7).

### 3.1 Opportunity progression — semi-Markov

Stage advance is a hazard, not a fixed probability, because dwell time matters: a
deal sitting in `proposal` for three weeks is not the same as one that arrived
yesterday.

Per day, for opportunity in stage `s`, `d` days since last contact:

```
λ_advance(s, d) = base_advance(s) · contact_boost(d) · cycle_position(s, d)
λ_die(s, d)     = base_die(s) · silence_decay(d)
P(stay)         = 1 − λ_advance − λ_die
```

- `contact_boost` decays over ~7 days after a touch — recent contact makes
  advance more likely, and that decay is exactly why timing matters.
- `silence_decay` rises with `d` past the counterparty's expected reply window.
- `cycle_position` peaks mid-cycle for counterparties with a known buying cycle,
  which is what makes "day 4 of 10" a real signal rather than a flourish.

### 3.2 Reply arrival — survival model

For each item waiting on a person, model reply as an exponential hazard with a
per-person rate learned from observed response latency:

```
P(reply by day t) = 1 − exp(−λ_p · t)
```

A follow-up is an intervention on this process: it resets the clock and
multiplies `λ_p` by a nudge factor for a window. **This is the mechanism by
which a 30-minute email changes a probability distribution** — and it is why the
simulator can price it against a six-hour task.

### 3.3 Task completion — capacity-limited

Deterministic given allocation; stochastic because capacity is:

```
capacity(day) ~ Normal(μ_focus, σ) truncated by calendar
```

Tasks draw from remaining capacity in admissibility order. A task completes when
cumulative allocated effort ≥ its estimate. Completion unblocks dependents on the
next step — which is how clearing a bottleneck compounds in simulation instead of
being asserted by a multiplier.

### 3.4 Project momentum — decay plus arrivals

Existing exponential decay runs forward unchanged, plus new events arriving as a
Poisson process with a per-project rate learned from history. Momentum is
therefore *mean-reverting toward the arrival rate*, which correctly makes a
one-off burst fade and sustained activity persist.

### 3.5 Exogenous arrivals

New inbound, cancellations, and unplanned work arrive at a learned base rate.
These matter because they consume capacity — a plan that assumes a clear week is
wrong about half the time, and the simulator should know that.

---

## 4. Interventions

An action is a surgical modification of substrate at `t=0`, then dynamics run.
Formally `do(a)` — the intervention is applied, not conditioned on.

| Action kind | Intervention |
|---|---|
| Send follow-up | `lastContactAt := now`; boost `λ_p` for window; consume 0.5h capacity |
| Complete task | mark done; unblock dependents; consume `effort` capacity |
| Advance opportunity | stage transition attempt with elevated `λ_advance` |
| Do nothing | consume nothing — the baseline arm |

**Capacity coupling is what makes this a real comparison.** Because every action
consumes from the same capacity budget, doing `a` genuinely means not doing `b`
inside the simulation. Opportunity cost is modelled rather than assumed, which
is precisely what the scalar leverage score could not do.

---

## 5. The value function

What makes one future better must ladder to Objectives, or the simulator is
optimising something nobody asked for.

```
V(state, t) = Σ_o  w_o · progress_o(state) · γ^(t/H)  −  ρ · risk(state)
```

- `progress_o` — for a revenue objective, expected closed value against target;
  for a milestone objective, fraction of gating work complete.
- `w_o` — objective priority, normalised. **This is the steering wheel:** change
  an objective's priority and every recommendation re-ranks.
- `γ` — discount. Near 1 for strategic horizons, lower when cash timing matters.
- `ρ · risk` — penalty using the risk score the engine already computes.

### Risk aversion

Ranking on `E[V]` alone is wrong for an operator with finite runway: it will
accept a plan with high expected value and a fat left tail. So the default
objective is downside-aware:

```
score(a) = E[ΔV] + κ · min(0, CVaR₁₀(ΔV))
```

`CVaR₁₀` is the mean of the worst 10% of outcomes, so it is **negative when the
tail is bad** — which means it is *added*, not subtracted. (Writing this as
`E[ΔV] − κ·CVaR` is the natural-looking form and is wrong: it rewards a fat left
tail. The sign here is worth stating explicitly because the error is invisible
until you notice a high-downside action outranking a safe one.)

`κ = 0` recovers pure expected value; the default is `κ > 0`, so an action that is
usually good but occasionally catastrophic loses to one that is reliably decent. This is a *policy* choice and
belongs in Constraints, not hard-coded.

---

## 6. Propagation, and why determinism survives

Monte Carlo: sample `N` trajectories per arm over horizon `H`.

Two techniques carry real weight here:

**Common random numbers.** The baseline arm and every candidate arm are run with
*the same random draws*. Differences between arms are then attributable to the
intervention rather than to sampling noise. This is a large variance reduction —
it lets `N` be in the hundreds rather than the tens of thousands, and it makes
paired comparison (`P(a beats ∅)`) meaningful.

**Seeded PRNG.** The whole build rests on reproducibility and auditability
(`ARCHITECTURE.md` §2). Monte Carlo threatens that — so the seed is derived from
the snapshot ID and stored *in* the snapshot:

```
seed = hash(snapshotId)   →  same substrate + same seed = byte-identical simulation
```

Reproducibility is preserved exactly. A past recommendation can be re-simulated
and will produce the same distribution it produced then. **Stochastic modelling
does not mean unreproducible results**, and giving that up would have cost more
than the simulator is worth.

Multi-resolution horizon, because "what do I do now" needs detail near `t=0` and
not at `t=H`:

| Segment | Resolution |
|---|---|
| Today | hourly (capacity and scheduling bind here) |
| Days 1–14 | daily |
| Beyond | weekly to the objective horizon |

---

## 7. Calibration — the part that decides whether this is worth anything

**An uncalibrated simulator is worse than no simulator.** It emits confident
numbers, those numbers drive decisions, and nobody can tell they are wrong. This
section is not optional infrastructure; it is the thing that makes the rest
legitimate.

### Every prediction is scored

When the simulator asserts `P(Northgate advances within 14 days) = 0.35`, that
prediction is logged with its resolution date. When the date arrives the outcome
is recorded and scored:

```
Brier = (1/n) Σ (p_i − o_i)²        // 0 = perfect, 0.25 = coin flip
```

Reliability curves are maintained per process — opportunity advance, reply
arrival, task completion — because the system can be well calibrated on replies
and badly calibrated on deals, and the fix differs.

### Cold start is handled by being honest, not by guessing

With no history, parameters are priors, not estimates. Beta-Binomial conjugacy
gives this for free:

```
p ~ Beta(α₀ + successes, β₀ + failures)
```

Small `n` → wide posterior → wide predictive interval. The correct early-life
behaviour is **embarrassingly wide intervals, stated plainly**: "+£18k expected,
but the 80% interval spans −£12k to +£61k, based on 3 observed deals." That is
useful. A confident point estimate from three data points is not.

### The system reports its own reliability

The confidence attached to a simulated recommendation is a function of measured
calibration, not of sample size. Until a process has enough scored predictions,
its output is labelled `uncalibrated` and the UI says so. **A recommendation
derived from an uncalibrated process must never be presented with the same
authority as a calibrated one.**

### The feedback-loop problem

Trajectory influences what it predicts. If it recommends following up with Tom
and that happens and Tom replies, the prediction is not independent of the
outcome — so naive scoring flatters the model.

Partial resolution: **recommendations that were not taken are natural controls.**
Those get scored too, and the gap between predicted and actual on the untaken arm
is the cleaner calibration signal. It is imperfect — untaken actions are not
randomly assigned — and it should be reported as the weaker evidence it is.

---

## 8. What a recommendation becomes

```ts
interface SimulatedRecommendation {
  action: RecommendedAction
  horizonDays: number

  expectedDelta: number          // E[ΔV] vs doing nothing
  interval: [number, number]     // 10th–90th percentile of ΔV
  probabilityOfImprovement: number
  downside: number               // CVaR₁₀(ΔV)
  score: number                  // E[ΔV] − κ·CVaR₁₀

  /** How the action moves specific objectives — the readable part. */
  objectiveShifts: {
    objectiveId: string
    label: string
    baseline: number             // P(on track) without the action
    withAction: number           // P(on track) with it
  }[]

  /** Cost of delay: the same action taken later. */
  decay: { days: number; expectedDelta: number }[]

  calibration: {
    status: "calibrated" | "provisional" | "uncalibrated"
    brier?: number
    observations: number
  }

  mechanism: string              // which dynamics produced the shift
}
```

`decay` is the field that earns its place in a voice brief. It is what converts
"follow up with Tom" into a genuine claim about timing:

> "Following up with Company X today moves them from 61% to 74% likely to close
> this quarter. The same email on Friday is worth about half that, because
> you'd be at day 7 of a 10-day cycle. That's the most this action is ever
> worth — it declines from here."

That sentence is only sayable because the counterfactual was simulated.

---

## 9. Cost

Simulation is `N × H × K` engine evaluations. Uncontrolled, that is thousands of
`runEngine()` calls per recompute. Controlled by a two-stage funnel:

```
all candidates ──leverage (cheap heuristic)──▶ top K=5 admissible
                                                   │
                                                   ▼
                                        simulate K + baseline (N=200)
                                                   │
                                                   ▼
                                        rank by E[ΔV] − κ·CVaR₁₀
```

**Leverage does not disappear — it is demoted to a prior.** It is a fast,
defensible ordering used to decide what is worth simulating. This also means the
system degrades gracefully: if simulation is disabled or fails, ranking falls
back to leverage and the product still works.

Simulation runs on the same trigger as narrative synthesis (`ARCHITECTURE.md`
§7): when the *decision* might change, not on every observation.

---

## 10. Limits, stated plainly

1. **Model risk dominates.** The dynamics in §3 are assumptions about how deals
   and people behave. Wrong dynamics produce confidently wrong answers, and no
   amount of Monte Carlo fixes a mis-specified model. Calibration scoring is the
   only defence, which is why §7 is load-bearing.
2. **Small-n reality.** One healthcare deal is not a distribution. For a
   single-operator business, several processes will stay `provisional` for
   months. The interval widths must reflect that rather than being cosmetically
   tightened.
3. **Unmodelled exogeneity.** The largest changes to a trajectory — a new
   inbound, a lost customer, a funding event — arrive from outside the model.
   The simulator is a tool for pricing *available actions*, not for forecasting
   the business.
4. **Objective misspecification.** The simulator optimises `V`. If `V` does not
   encode what actually matters, it will optimise the wrong thing efficiently.
   This is a real risk and the reason `w_o` is operator-set and visible.
5. **Not causal inference.** `do(a)` is applied inside an assumed model. This is
   simulation under assumptions, not identification from data.

The honest positioning: this makes the *relative ordering* of a handful of
available actions better than a scalar heuristic can, and it makes the reasoning
inspectable. It does not predict the future.

---

## 11. Integration

The simulator extends the DERIVATION tier. Pipeline from `ARCHITECTURE.md` §5,
with new stages:

```
 1–6.  load → momentum → graph → commitments → constraints → candidates
 7.    admissibility            → admissible set
 8.    NEW  funnel              → top K by leverage prior
 9.    NEW  baseline simulation → N trajectories, do(∅)
10.    NEW  counterfactual      → N trajectories per candidate, common seeds
11.    NEW  distributional rank → E[ΔV] − κ·CVaR₁₀
12.    risk → memory → synthesis → snapshot (+ seed, + predictions logged)
```

New substrate tables: `simulation_runs`, `predictions` (with resolution dates),
`calibration_scores`, `process_parameters` (the learned Beta posteriors).

### Build order

1. **Kernel** — seeded PRNG, forward model, value function, MC runner. *Provable
   in isolation against the existing seed data.* ← implemented, see §12
2. **Prediction log** — persist predictions with resolution dates. Nothing is
   calibrated until this exists, so it comes before anything depends on the
   numbers.
3. **Counterfactual ranking** — wire into the recommendation pipeline behind a
   flag, with leverage as fallback.
4. **Calibration scoring** — resolve predictions, compute Brier, gate confidence
   labels on it.
5. **Parameter learning** — replace priors with Beta posteriors from observed
   outcomes.
6. **Surfacing** — intervals and decay curves in brief, board and chat.

Steps 1–2 are worth doing immediately; **step 3 should not ship to a decision
surface before step 4 exists**, or the system will present uncalibrated numbers
with unearned authority.

---

## 12. Implemented kernel — and what running it revealed

`src/lib/simulation/` contains a working kernel: seeded PRNG with per-process
streams, the five dynamics of §3, interventions with capacity coupling, the
value function with CVaR, and a common-random-numbers Monte Carlo runner.

```
GET /api/simulate?n=800&horizon=28&k=5
```

**Determinism is preserved.** Repeated calls return byte-identical results; the
seed is derived from substrate, not from the clock.

### Four things the first runs exposed

Recorded because they are the failure modes this kind of system produces, and
each one would have shipped as a confident wrong number.

1. **Two clocks were conflated.** `daysSinceContact` was driving both
   responsiveness *and* buying-cycle position, so contacting someone appeared to
   rewind their decision process — and the decay curve ran backwards, valuing a
   follow-up more if you delayed it. Their decision clock (`cycleDay`) advances
   regardless of what you do. Fixed.

2. **Tasks and deals were independent processes.** Clearing a bottleneck could
   never show commercial value, because nothing connected internal work to deal
   progression. Opportunities now carry `gatedByTaskIds`, and a deal waiting on
   a deliverable barely advances until it lands. This is the mechanism by which
   internal work becomes revenue, and without it the whole Northgate case was
   invisible to the simulator.

3. **The CVaR sign was inverted.** `E[ΔV] − κ·CVaR` reads naturally and is
   wrong: CVaR is negative when the tail is bad, so subtracting it *rewarded*
   catastrophic downside. A high-variance action was ranking first. See §5.

4. **Capacity was far too generous.** At 5.5h/day of tracked work everything
   completed in every trajectory, so task ordering had no consequence and every
   task intervention scored exactly zero. Tracked-work capacity is ~2.5h/day;
   the rest of the day is not task execution.

### Honest read of the current output

At `n=800`, only two of five candidates produce a signal distinguishable from
Monte Carlo noise. The kernel now reports `standardError` and
`effectiveSamples` per candidate precisely so this is visible: the value signal
is driven by rare discrete events, so most paired trajectories tie and effective
sample size is ~15% of N.

**Where `standardError` is comparable to `expectedDelta`, only the ordering
carries information — the magnitude does not.** That is the correct behaviour
for an uncalibrated model, and it is why every response carries
`calibration.status: "uncalibrated"` until step 4 of the build order lands.

One emergent result worth noting: chasing Northgate scores *negatively* while
their compliance pack is outstanding — pressing a client for a decision on work
you owe them is counterproductive, and it displaces the capacity that would
clear the gate. Nothing encoded that; it fell out of the gating coupling and
capacity competition. It also happens to match the seeded memory about the
previous healthcare deal stalling for exactly that reason.
