// mysql2 connection pool — used for routes that hit Prisma's "timer has gone
// away" panic bug on Hostinger's OpenSSL 1.1.x runtime. Same DATABASE_URL,
// no native engine. Prisma stays in use for writes and simple reads where it
// happens to work, but complex findMany queries route through here.
//
// Serverless behaviour (Vercel): we lazily create the pool on first request
// and shrink connectionLimit so a single warm function instance doesn't
// hoard connections. Outside Vercel (Hostinger Passenger), we keep the
// larger pool for concurrency.

import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

function parseUrl(url) {
  const m = url.match(/^mysql:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/(.+)$/);
  if (!m) throw new Error('DATABASE_URL not in mysql://user:pass@host:port/db form');
  return {
    user: decodeURIComponent(m[1]),
    password: decodeURIComponent(m[2]),
    host: m[3],
    port: Number(m[4]),
    database: m[5],
  };
}

const isServerless = !!process.env.VERCEL;

let _pool = null;
function getPool() {
  if (_pool) return _pool;
  const cfg = parseUrl(env.DATABASE_URL);
  _pool = mysql.createPool({
    ...cfg,
    waitForConnections: true,
    connectionLimit: isServerless ? 2 : 8,
    queueLimit: 0,
    enableKeepAlive: !isServerless,
    keepAliveInitialDelay: 0,
    idleTimeout: isServerless ? 8000 : 60_000,
    connectTimeout: 10_000,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  return _pool;
}

// Backwards-compatible export — most callers just call query()/queryOne().
export const pool = new Proxy({}, {
  get(_t, prop) {
    const p = getPool();
    const v = p[prop];
    return typeof v === 'function' ? v.bind(p) : v;
  },
});

export async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}
