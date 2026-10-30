export type RunStatus = 'ok' | 'retry' | 'fail';

// One job across the night. Times keep the offset from the log.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type Night = {
  rows: DigestRow[];
  badLines: number;
  // Log lines per status across the night; bad lines are not counted.
  counts: { ok: number; retry: number; fail: number };
};

// Rows sorted by job. null when the night has no file; an empty file gives no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
