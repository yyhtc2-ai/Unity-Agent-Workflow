import { renameSync } from "node:fs";

/** Retry transient sharing violations without deleting the previous snapshot. */
export function replaceFile(
  source: string,
  target: string,
  rename: typeof renameSync = renameSync,
  pause: (ms: number) => void = ms => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
): void {
  const delays = [10, 20, 40, 80, 160, 320, 640];
  for (let attempt = 0; ; attempt++) {
    try { rename(source, target); return; }
    catch (err) {
      const delay = delays[attempt];
      if (delay === undefined || !["EPERM", "EACCES", "EBUSY"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
      pause(delay);
    }
  }
}
