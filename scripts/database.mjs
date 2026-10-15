import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  data = resolve(root, '.data'),
  pg = resolve(data, 'postgres');
const bin = process.env.PG_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
const run = (cmd, args, extra = {}) =>
  execFileSync(resolve(bin, cmd), args, { stdio: 'inherit', ...extra });
const marker = resolve(data, 'voxel-owned');
if (process.argv[2] === 'stop') {
  if (!existsSync(marker)) throw Error('No project database ownership marker');
  run('pg_ctl', ['-D', pg, '-m', 'fast', 'stop']);
  process.exit(0);
}
if (existsSync(pg) && !existsSync(marker))
  throw Error('Refusing to use unmarked database directory');
mkdirSync(data, { recursive: true });
if (!existsSync(pg)) {
  writeFileSync(marker, 'agent-voxel-world local database\n');
  writeFileSync(resolve(data, 'password'), 'voxel', { mode: 0o600 });
  run('initdb', [
    '-D',
    pg,
    '-U',
    'voxel',
    '--pwfile=' + resolve(data, 'password'),
    '--auth=scram-sha-256',
    '--encoding=UTF8',
    '--locale=C',
  ]);
}
let running = false;
try {
  execFileSync(resolve(bin, 'pg_ctl'), ['-D', pg, 'status'], {
    stdio: 'ignore',
  });
  running = true;
} catch {}
if (!running) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(55432, '127.0.0.1', () => probe.close(resolve));
  });
  run('pg_ctl', [
    '-D',
    pg,
    '-l',
    resolve(data, 'postgres.log'),
    '-o',
    `-p 55432 -h 127.0.0.1 -k ${data}`,
    '-w',
    'start',
  ]);
}
const env = { ...process.env, PGPASSWORD: 'voxel' };
const dbs = execFileSync(
  resolve(bin, 'psql'),
  [
    '-h',
    '127.0.0.1',
    '-p',
    '55432',
    '-U',
    'voxel',
    '-d',
    'postgres',
    '-Atc',
    "SELECT datname FROM pg_database WHERE datname='voxel'",
  ],
  { env, encoding: 'utf8' },
);
if (!dbs.trim())
  run('createdb', ['-h', '127.0.0.1', '-p', '55432', '-U', 'voxel', 'voxel'], {
    env,
  });
if (!existsSync(resolve(root, '.env')))
  writeFileSync(
    resolve(root, '.env'),
    'DATABASE_URL=postgresql://voxel:voxel@127.0.0.1:55432/voxel?schema=public\n',
    { mode: 0o600 },
  );
console.log(
  'Project-only PostgreSQL ready on 127.0.0.1:55432. Run pnpm db:migrate.',
);
