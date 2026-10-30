import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

type Line = { at: string; job: string; status: 'ok' | 'retry' | 'fail'; owner: string | null; error?: string };
type Body = { night: string; rows: { job: string; owner: string | null; retries: number }[]; badLines: number };

let runsDir = '';
const app = () =>
  createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

function writeNight(night: string, lines: Line[], extra: string[] = []) {
  const body = [...lines.map((l) => JSON.stringify(l)), ...extra].join('\n');
  writeFileSync(join(runsDir, `${night}.jsonl`), body === '' ? '' : `${body}\n`);
}

// The <tr> chunk of the page that mentions the job.
function rowHtml(html: string, job: string): string {
  const chunk = html.split('<tr').find((c) => c.includes(job));
  if (chunk === undefined) throw new Error(`no row for ${job}`);
  return chunk;
}

function expectInOrder(html: string, jobs: string[]) {
  const positions = jobs.map((j) => html.indexOf(j));
  expect(positions.every((p) => p >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

const at = (m: number) => `2026-10-28T02:${String(m).padStart(2, '0')}:00+01:00`;
const SORTED = ['alpha-backup', 'broken-job', 'few-retry', 'mid-retry', 'zeta-sync'];

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));

  // Written out of order on purpose: rows must come back sorted by job.
  writeNight('2026-10-20', [
    { at: at(1), job: 'zeta-sync', status: 'ok', owner: 'ola' },
    { at: at(2), job: 'alpha-backup', status: 'ok', owner: null },
    { at: at(3), job: 'mid-retry', status: 'retry', owner: 'ola' },
    { at: at(4), job: 'mid-retry', status: 'retry', owner: 'ola' },
    { at: at(5), job: 'mid-retry', status: 'retry', owner: 'ola' },
    { at: at(6), job: 'mid-retry', status: 'ok', owner: 'ola' },
    { at: at(7), job: 'few-retry', status: 'retry', owner: 'ola' },
    { at: at(8), job: 'few-retry', status: 'ok', owner: 'ola' },
    { at: at(9), job: 'broken-job', status: 'fail', owner: 'ola', error: 'boom' },
  ]);
  writeNight('2026-10-21', []);
  writeNight(
    '2026-10-22',
    [
      { at: at(1), job: 'good-b', status: 'ok', owner: 'ola' },
      { at: at(2), job: 'good-a', status: 'ok', owner: 'ola' },
    ],
    ['this is not json'],
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('renders one table of rows sorted by job', async () => {
    const res = await app().request('/digest/2026-10-20');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html.match(/<table/g)).toHaveLength(1);
    expectInOrder(html, SORTED);
  });

  it('marks rows with 3 or more retries and rows whose last status is fail', async () => {
    const html = await (await app().request('/digest/2026-10-20')).text();
    expect(rowHtml(html, 'mid-retry')).toMatch(/class="[^"]*\bwarn\b/);
    expect(rowHtml(html, 'broken-job')).toMatch(/class="[^"]*\bwarn\b/);
    expect(rowHtml(html, 'few-retry')).not.toMatch(/\bwarn\b/);
    expect(rowHtml(html, 'zeta-sync')).not.toMatch(/\bwarn\b/);
  });

  it('shows a missing owner as a dash', async () => {
    const html = await (await app().request('/digest/2026-10-20')).text();
    expect(rowHtml(html, 'alpha-backup')).toContain('—');
  });

  it('404 for a night with no file', async () => {
    expect((await app().request('/digest/2026-01-01')).status).toBe(404);
  });

  it('404 for an invalid night', async () => {
    expect((await app().request('/digest/..%2Fx')).status).toBe(404);
    expect((await app().request('/digest/not-a-date')).status).toBe(404);
  });

  it('empty file is 200 and says nothing ran', async () => {
    const res = await app().request('/digest/2026-10-21');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('a bad line still renders the good rows and reports the bad line', async () => {
    const res = await app().request('/digest/2026-10-22');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('good-a');
    expect(html).toContain('good-b');
    expect(html).toContain('1 bad line');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns night, rows and badLines as JSON', async () => {
    const res = await app().request('/api/digest/2026-10-20');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.night).toBe('2026-10-20');
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r) => r.job)).toEqual(SORTED);
    expect(body.rows.find((r) => r.job === 'alpha-backup')?.owner).toBeNull();
    expect(body.rows.find((r) => r.job === 'mid-retry')?.retries).toBe(3);
  });

  it('404 for a night with no file', async () => {
    expect((await app().request('/api/digest/2026-01-01')).status).toBe(404);
  });

  it('empty file gives no rows', async () => {
    const res = await app().request('/api/digest/2026-10-21');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: '2026-10-21', rows: [], badLines: 0 });
  });

  it('a bad line counts as one and keeps the good rows', async () => {
    const res = await app().request('/api/digest/2026-10-22');
    const body = (await res.json()) as Body;
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['good-a', 'good-b']);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    for (const night of ['2026-10-20', '2026-10-22']) {
      const html = await (await app().request(`/digest/${night}`)).text();
      const body = (await (await app().request(`/api/digest/${night}`)).json()) as Body;
      expectInOrder(html, body.rows.map((r) => r.job));
    }
  });
});
