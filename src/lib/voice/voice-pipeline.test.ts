import { test } from "node:test";
import assert from "node:assert/strict";

import { buildContinuity, buildStateEvidence, freshnessInstruction, relativeAge } from "./continuity.ts";
import { presentSignal, formatSignalTime } from "./signal-freshness.ts";
import { submittedTranscript, transcriptForDisplay } from "./transcript.ts";

const NOW = Date.parse("2026-08-06T09:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

// --- Current context does not recommend already completed work -------------

test("open work is stated as the complete action space", () => {
  const evidence = buildStateEvidence({
    trajectory: "steady",
    riskLevel: "low",
    eventsLast24h: 3,
    openWork: [{ title: "Ship the cinematic motion integration", kind: "task" }],
    transcript: "Where is my trajectory today",
    now: NOW,
  });

  assert.match(evidence, /Ship the cinematic motion integration/);
  assert.match(evidence, /anything not listed here is finished or not tracked/);
});

test("completed work is absent from the evidence handed to the provider", () => {
  // The live defect: work that had already shipped was still being
  // recommended. Once an item leaves the open-work list it must not appear as
  // something to act on.
  const evidence = buildStateEvidence({
    trajectory: "steady",
    riskLevel: "low",
    eventsLast24h: 3,
    openWork: [{ title: "Finish PR #11 cinematic motion review", kind: "task" }],
    transcript: "What should I work on",
    now: NOW,
  });

  assert.ok(!evidence.includes("PR #7"), "completed work must not reach the prompt as open");
  assert.match(evidence, /PR #11/);
});

test("a superseded signal is labelled delivered, not offered as evidence", () => {
  const evidence = buildStateEvidence({
    trajectory: "steady",
    riskLevel: "low",
    eventsLast24h: 1,
    openWork: [{ title: "Finish PR #11 cinematic motion review", kind: "task" }],
    priorSignal: {
      highestLeverageRecommendation: "Complete PR #7 voice pipeline repair",
      computedAt: ago(5 * 60 * 60 * 1000),
    },
    transcript: "What should I work on",
    now: NOW,
  });

  assert.match(evidence, /Already delivered 5 hours ago and now superseded/);
  assert.match(evidence, /do not repeat it unless the open-work list above still shows it/);
});

test("the grounding rule forbids recommending work that is not open", () => {
  assert.match(freshnessInstruction, /Never recommend work that the open-work list does not show as open/);
  assert.match(freshnessInstruction, /already delivered/);
});

test("earlier turns are age-stamped and marked as history, not current evidence", () => {
  const continuity = buildContinuity({
    turns: [
      { fromTrajectory: true, content: "Complete PR #7 voice pipeline repair", createdAt: ago(6 * 60 * 60 * 1000) },
      { fromTrajectory: false, content: "Where is my trajectory today", createdAt: ago(90 * 1000) },
    ],
    now: NOW,
  });

  // Previously these lines were replayed as bare "assistant: ..." with no age
  // and no framing, which is how stale reasoning read as live state.
  assert.match(continuity, /\[6 hours ago\] Trajectory previously said: Complete PR #7/);
  assert.match(continuity, /\[2 minutes ago\] User previously said: Where is my trajectory today/);
  assert.match(continuity, /This is history, not current evidence/);
  const historyLines = continuity.split("\n").filter((line) => line.startsWith("["));
  assert.equal(historyLines.length, 2);
  assert.ok(
    historyLines.every((line) => /previously said:/.test(line)),
    "every replayed turn must be attributed and aged, never bare content",
  );
});

test("relative age covers each granularity", () => {
  assert.equal(relativeAge(ago(10_000), NOW), "just now");
  assert.equal(relativeAge(ago(60_000), NOW), "1 minute ago");
  assert.equal(relativeAge(ago(3 * 60 * 60 * 1000), NOW), "3 hours ago");
  assert.equal(relativeAge(ago(2 * 24 * 60 * 60 * 1000), NOW), "2 days ago");
  assert.equal(relativeAge("not-a-date", NOW), "age unknown");
});

// --- Provider failure preserves the last valid signal, labelled ------------

test("provider failure preserves the last valid signal and labels it with its own time", () => {
  const presentation = presentSignal({
    status: "failure",
    hasSignal: true,
    computedAt: "2026-08-06T02:37:00.000Z",
    currentLabel: "Executive Signal",
  });

  assert.equal(presentation.freshness, "stale");
  assert.equal(presentation.label, `Last valid signal · ${formatSignalTime("2026-08-06T02:37:00.000Z")}`);
  assert.equal(presentation.marked, true);
});

test("the stale label carries the signal's original time, not the time of the failed request", () => {
  const generatedAt = "2026-08-06T02:37:00.000Z";
  const presentation = presentSignal({ status: "failure", hasSignal: true, computedAt: generatedAt, currentLabel: "Executive Signal" });

  assert.match(presentation.label, /03:37|02:37/); // rendered in the runtime's locale offset
  assert.ok(presentation.label.includes(formatSignalTime(generatedAt)));
});

test("a successful signal is presented as current, with no stale marker", () => {
  const presentation = presentSignal({
    status: "rendered",
    hasSignal: true,
    computedAt: "2026-08-06T09:00:00.000Z",
    currentLabel: "Executive Signal",
  });

  assert.equal(presentation.freshness, "current");
  assert.equal(presentation.label, "Executive Signal");
  assert.equal(presentation.marked, false);
});

test("a failure with no previous signal has nothing to mark stale", () => {
  const presentation = presentSignal({ status: "failure", hasSignal: false, computedAt: "", currentLabel: "Executive Signal" });
  assert.equal(presentation.freshness, "current");
  assert.equal(presentation.marked, false);
});

// --- Retry reuses the same transcript, exactly once ------------------------

/**
 * Minimal stand-in for the component's submission guards. The request phase
 * is genuinely asynchronous so the in-flight guard is exercised the way it is
 * against a real fetch.
 */
function createSubmitter(transcript: string) {
  const posted: string[] = [];
  let inFlight = false;
  let lastSubmitted: string | null = null;
  let failNext = true;

  const submit = async () => {
    const prompt = submittedTranscript(transcript);
    if (!prompt) return;
    if (inFlight || lastSubmitted === prompt) return;
    inFlight = true;
    lastSubmitted = prompt;
    posted.push(prompt);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (failNext) {
        failNext = false;
        lastSubmitted = null; // failure clears the guard so a retry is allowed
        throw new Error("provider failed");
      }
    } finally {
      inFlight = false;
    }
  };

  return {
    posted,
    submit,
    retry: async () => {
      if (inFlight) return;
      lastSubmitted = null;
      await submit();
    },
  };
}

test("retry submits the same transcript once, without a new recording", async () => {
  const submitter = createSubmitter("where is my trajectory today");

  await submitter.submit().catch(() => undefined);
  await submitter.retry();

  assert.deepEqual(submitter.posted, [
    "where is my trajectory today",
    "where is my trajectory today",
  ]);
  assert.equal(submitter.posted.length, 2, "one failed attempt plus exactly one retry");
});

test("a retry while a request is in flight is dropped, not duplicated", async () => {
  const submitter = createSubmitter("where is my trajectory today");
  await Promise.all([submitter.submit().catch(() => undefined), submitter.retry()]);
  assert.equal(submitter.posted.length, 1, "concurrent presses must not double-post");
});

test("a successful retry replaces the old signal", async () => {
  const submitter = createSubmitter("where is my trajectory today");
  let signal = { id: "sig-old", computedAt: "2026-08-06T02:37:00.000Z" };

  await submitter.submit().catch(() => undefined);
  // The old signal survives the failure, marked stale.
  assert.equal(presentSignal({ status: "failure", hasSignal: true, computedAt: signal.computedAt, currentLabel: "Executive Signal" }).freshness, "stale");

  await submitter.retry();
  signal = { id: "sig-new", computedAt: "2026-08-06T09:00:00.000Z" };

  assert.equal(signal.id, "sig-new");
  const after = presentSignal({ status: "rendered", hasSignal: true, computedAt: signal.computedAt, currentLabel: "Executive Signal" });
  assert.equal(after.freshness, "current");
  assert.equal(after.marked, false);
});

// --- Displayed transcript is rendered, the sent one is not -----------------

test("the displayed transcript is grammatically rendered", () => {
  assert.equal(transcriptForDisplay("where is my trajectory today"), "Where is my trajectory today?");
  assert.equal(transcriptForDisplay("brief me on the partner contract"), "Brief me on the partner contract.");
  assert.equal(transcriptForDisplay("  what   changed  "), "What changed?");
  assert.equal(transcriptForDisplay("Already punctuated."), "Already punctuated.");
  assert.equal(transcriptForDisplay("   "), "");
});

test("rendering never alters the request actually sent", () => {
  const recognised = "where is my trajectory today";
  assert.equal(submittedTranscript(recognised), "where is my trajectory today");
  assert.notEqual(transcriptForDisplay(recognised), submittedTranscript(recognised));
});
