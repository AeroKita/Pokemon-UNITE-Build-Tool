/**
 * Worker-side job lifecycle for emblem search.
 * Tracks active job id, cancel requests, and a generation counter so stale
 * searches abort promptly when superseded or cancelled.
 */

export interface WorkerJobContext {
  jobId: string;
  generation: number;
  shouldAbort: () => boolean;
}

export function createWorkerJobState() {
  let activeJobId: string | null = null;
  let searchGeneration = 0;
  const cancelledJobIds = new Set<string>();

  function onCancel(jobId: string): void {
    cancelledJobIds.add(jobId);
    if (jobId === activeJobId) {
      searchGeneration++;
    }
  }

  function beginRun(jobId: string): WorkerJobContext {
    if (activeJobId && activeJobId !== jobId) {
      cancelledJobIds.add(activeJobId);
    }

    const generation = ++searchGeneration;
    activeJobId = jobId;
    cancelledJobIds.delete(jobId);

    const shouldAbort = () =>
      generation !== searchGeneration ||
      jobId !== activeJobId ||
      cancelledJobIds.has(jobId);

    return { jobId, generation, shouldAbort };
  }

  function clearCancelled(jobId: string): void {
    cancelledJobIds.delete(jobId);
  }

  function wasCancelled(jobId: string): boolean {
    return cancelledJobIds.has(jobId);
  }

  return {
    onCancel,
    beginRun,
    clearCancelled,
    wasCancelled,
    getActiveJobId: () => activeJobId,
    getSearchGeneration: () => searchGeneration,
  };
}
