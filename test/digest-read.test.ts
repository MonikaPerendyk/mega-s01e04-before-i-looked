import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

describe('readNight on a real night', () => {
  const night = readNight('runs', '2026-10-28');
  const row = (job: string) => night?.rows.find((r) => r.job === job);

  it('gives 5 jobs sorted by job, and counts the truncated line', () => {
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night?.badLines).toBe(1);
  });

  it('keeps a job whose owner is null', () => {
    expect(row('digest/render')).toEqual({
      job: 'digest/render',
      owner: null,
      runs: 1,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00',
      lastAt: '2026-10-29T05:41:09+01:00',
    });
  });

  it('counts retries, and a job that recovered has no last error', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps the error of a job that ended failed', () => {
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('skips the truncated line when counting runs', () => {
    expect(row('lane/sync')).toMatchObject({
      runs: 8,
      retries: 1,
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });
});

describe('readNight on a temp dir', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (lines: string[]) => writeFileSync(join(dir, 'n.jsonl'), lines.join('\n'));
  const ok = { at: '2026-10-28T23:00:00+01:00', job: 'a', status: 'ok', owner: 'rook' };

  it('returns null for a night with no file', () => {
    expect(readNight(dir, 'n')).toBeNull();
  });

  it('gives no rows for an empty file', () => {
    write([]);
    expect(readNight(dir, 'n')).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('surfaces fs errors other than ENOENT', () => {
    mkdirSync(join(dir, 'n.jsonl'));
    expect(() => readNight(dir, 'n')).toThrow();
  });

  it('does not count blank lines or a trailing newline as bad', () => {
    write([JSON.stringify(ok), '', '   ', '']);
    expect(readNight(dir, 'n')).toMatchObject({ badLines: 0, rows: [{ job: 'a', runs: 1 }] });
  });

  it('counts lines with the wrong shape as bad and skips them', () => {
    write([
      JSON.stringify(ok),
      'null',
      '42',
      JSON.stringify({ ...ok, job: 7 }),
      JSON.stringify({ ...ok, status: 'skipped' }),
    ]);
    const night = readNight(dir, 'n');
    expect(night?.badLines).toBe(4);
    expect(night?.rows).toHaveLength(1);
    expect(night?.rows[0]?.runs).toBe(1);
  });

  it('sorts by code unit, not locale', () => {
    write([JSON.stringify({ ...ok, job: 'b' }), JSON.stringify({ ...ok, job: 'Z' })]);
    expect(readNight(dir, 'n')?.rows.map((r) => r.job)).toEqual(['Z', 'b']);
  });

  it('keeps the offset from the log', () => {
    write([JSON.stringify({ ...ok, at: '2026-10-28T23:00:00-05:00' })]);
    expect(readNight(dir, 'n')?.rows[0]?.firstAt).toBe('2026-10-28T23:00:00-05:00');
  });
});
