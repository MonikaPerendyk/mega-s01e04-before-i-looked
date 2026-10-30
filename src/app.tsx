import { Hono } from 'hono';
import { isNight } from './digest/night.js';
import { readNight } from './digest/read.js';
import { loadConfig, type RigConfig } from './config.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { DigestPage } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const data = isNight(night) ? readNight(config.runsDir, night) : null;
    if (data === null) return c.notFound();
    return c.html(
      <Layout title={`digest ${night}`} lane={lane()}>
        <DigestPage night={night} data={data} />
      </Layout>,
    );
  });

  app.get('/api/digest/:night', (c) => {
    const night = c.req.param('night');
    const data = isNight(night) ? readNight(config.runsDir, night) : null;
    if (data === null) return c.json({ error: 'no such night' }, 404);
    return c.json({ night, rows: data.rows, badLines: data.badLines });
  });

  return app;
}
