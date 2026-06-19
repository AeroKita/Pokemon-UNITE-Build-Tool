import { describe, it, expect, vi } from "vitest";
import type { SearchResult } from "../../engine/emblemSearch/types";
import {
  SearchWorkerController,
  type WorkerLike,
  type WorkerRunPayload,
} from "../searchWorkerController";

type Listener = (ev: { data: unknown }) => void;

/**
 * Fake worker that records posted messages and exposes a way to drive
 * message/error events back to the controller. Mirrors how the real worker
 * stays busy (never replies) when stuck in a long synchronous search.
 */
class FakeWorker implements WorkerLike {
  posted: unknown[] = [];
  terminated = false;
  private messageListener: Listener | null = null;
  private errorListener: ((ev: { message?: string }) => void) | null = null;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (ev: { message?: string }) => void): void;
  addEventListener(type: "message" | "error", listener: never): void {
    if (type === "message") this.messageListener = listener as Listener;
    else this.errorListener = listener as (ev: { message?: string }) => void;
  }

  emitMessage(data: unknown): void {
    this.messageListener?.({ data });
  }

  emitError(message: string): void {
    this.errorListener?.({ message });
  }

  lastRunId(): string | undefined {
    const run = [...this.posted].reverse().find(
      (m): m is { type: string; id: string } =>
        typeof m === "object" && m !== null && (m as { type?: string }).type === "run",
    );
    return run?.id;
  }
}

const PAYLOAD: WorkerRunPayload = {
  pool: [],
  options: {} as WorkerRunPayload["options"],
  setBonuses: [],
  effort: "normal",
};

const MOCK_RESULT = { candidates: 1, totalMs: 1 } as SearchResult;

describe("SearchWorkerController", () => {
  it("lazily creates a single worker and posts a run message", () => {
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker);
    const controller = new SearchWorkerController(factory);

    controller.run(PAYLOAD, () => {});

    expect(factory).toHaveBeenCalledTimes(1);
    expect(controller.hasWorker()).toBe(true);
    expect(worker.posted.some((m) => (m as { type?: string }).type === "run")).toBe(true);
  });

  it("resolves the run promise on a matching done message", async () => {
    const worker = new FakeWorker();
    const controller = new SearchWorkerController(() => worker);

    const promise = controller.run(PAYLOAD, () => {});
    worker.emitMessage({ type: "done", id: worker.lastRunId(), result: MOCK_RESULT });

    await expect(promise).resolves.toBe(MOCK_RESULT);
  });

  it("forwards progress only for the active job", () => {
    const worker = new FakeWorker();
    const controller = new SearchWorkerController(() => worker);
    const onProgress = vi.fn();

    controller.run(PAYLOAD, onProgress);
    const id = worker.lastRunId();

    worker.emitMessage({ type: "progress", id: "stale-job", pct: 10, label: "x" });
    worker.emitMessage({ type: "progress", id, pct: 42, label: "Searching" });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({ pct: 42, label: "Searching", candidates: undefined });
  });

  it("terminate() kills a busy worker and resolves the hung run with null", async () => {
    const worker = new FakeWorker();
    const controller = new SearchWorkerController(() => worker);

    // Worker is "busy": it never emits done (mirrors a long synchronous search).
    const promise = controller.run(PAYLOAD, () => {});

    controller.terminate();

    expect(worker.terminated).toBe(true);
    expect(controller.hasWorker()).toBe(false);
    // The previously hung await must settle so the next search can proceed.
    await expect(promise).resolves.toBeNull();
  });

  it("spawns a FRESH worker on the next run after terminate (cancel → rerun)", async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const workers = [first, second];
    const factory = vi.fn(() => workers.shift() ?? null);
    const controller = new SearchWorkerController(factory);

    // Start a long search, then cancel (terminate) it.
    const firstRun = controller.run(PAYLOAD, () => {});
    controller.terminate();
    await expect(firstRun).resolves.toBeNull();

    // Rerun: must build a brand new worker, not reuse the terminated one.
    const secondRun = controller.run(PAYLOAD, () => {});

    expect(factory).toHaveBeenCalledTimes(2);
    expect(controller.hasWorker()).toBe(true);
    expect(second.posted.some((m) => (m as { type?: string }).type === "run")).toBe(true);

    // The fresh worker drives the second search to completion normally.
    second.emitMessage({ type: "done", id: second.lastRunId(), result: MOCK_RESULT });
    await expect(secondRun).resolves.toBe(MOCK_RESULT);

    // The terminated first worker received no second run.
    expect(first.posted.filter((m) => (m as { type?: string }).type === "run")).toHaveLength(1);
  });

  it("rejects when the worker factory returns null (triggers main-thread fallback)", async () => {
    const controller = new SearchWorkerController(() => null);
    await expect(controller.run(PAYLOAD, () => {})).rejects.toThrow("Worker unavailable");
  });

  it("reuses the same worker across sequential completed runs", async () => {
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker);
    const controller = new SearchWorkerController(factory);

    const run1 = controller.run(PAYLOAD, () => {});
    worker.emitMessage({ type: "done", id: worker.lastRunId(), result: MOCK_RESULT });
    await run1;

    const run2 = controller.run(PAYLOAD, () => {});
    worker.emitMessage({ type: "done", id: worker.lastRunId(), result: MOCK_RESULT });
    await run2;

    expect(factory).toHaveBeenCalledTimes(1);
  });
});
