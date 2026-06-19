import { describe, it, expect } from "vitest";
import { createWorkerJobState } from "../emblemSearchWorkerState";

describe("createWorkerJobState", () => {
  it("invalidates an in-flight job when cancelled", () => {
    const state = createWorkerJobState();
    const job1 = state.beginRun("job-1");

    expect(job1.shouldAbort()).toBe(false);

    state.onCancel("job-1");

    expect(job1.shouldAbort()).toBe(true);
    expect(state.getSearchGeneration()).toBe(2);
  });

  it("invalidates a prior job when a replacement run begins", () => {
    const state = createWorkerJobState();
    const job1 = state.beginRun("job-1");
    const job2 = state.beginRun("job-2");

    expect(job1.shouldAbort()).toBe(true);
    expect(job2.shouldAbort()).toBe(false);
    expect(state.getActiveJobId()).toBe("job-2");
  });

  it("cancel then beginRun yields a fresh generation for the replacement job", () => {
    const state = createWorkerJobState();
    const cancelled = state.beginRun("job-1");
    state.onCancel("job-1");
    const replacement = state.beginRun("job-2");

    expect(cancelled.shouldAbort()).toBe(true);
    expect(replacement.shouldAbort()).toBe(false);
    expect(state.getSearchGeneration()).toBe(3);
  });

  it("marks cancelled jobs so completion can emit done(null)", () => {
    const state = createWorkerJobState();
    state.beginRun("job-1");
    state.onCancel("job-1");

    expect(state.wasCancelled("job-1")).toBe(true);

    state.clearCancelled("job-1");

    expect(state.wasCancelled("job-1")).toBe(false);
  });
});
