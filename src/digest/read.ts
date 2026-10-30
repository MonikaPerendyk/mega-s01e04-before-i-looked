import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};

function isRunStatus(value: unknown): value is RunStatus {
  return value === 'ok' || value === 'retry' || value === 'fail';
}

// The edge: anything that isn't a well-formed run line comes back as null.
function parseLine(line: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;

  const { at, job, status, owner, error } = value as Record<string, unknown>;
  if (typeof at !== 'string' || typeof job !== 'string' || !isRunStatus(status)) return null;
  if (typeof owner !== 'string' && owner !== null) return null;
  if (typeof error !== 'string' && error !== undefined && error !== null) return null;

  return { at, job, status, owner, error: error ?? null };
}

function readLog(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  const log = readLog(join(runsDir, `${night}.jsonl`));
  if (log === null) return null;

  const byJob = new Map<string, DigestRow>();
  let badLines = 0;

  for (const raw of log.split('\n')) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line === null) {
      badLines += 1;
      continue;
    }

    const row = byJob.get(line.job);
    byJob.set(line.job, {
      job: line.job,
      owner: line.owner,
      runs: (row?.runs ?? 0) + 1,
      retries: (row?.retries ?? 0) + (line.status === 'retry' ? 1 : 0),
      lastStatus: line.status,
      lastError: line.error,
      firstAt: row?.firstAt ?? line.at,
      lastAt: line.at,
    });
  }

  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { rows, badLines };
};
