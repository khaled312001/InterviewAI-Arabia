// mysql2 connection pool — used for routes that hit Prisma's "timer has gone
// away" panic bug on Hostinger's OpenSSL 1.1.x runtime. Same DATABASE_URL,
// no native engine. Prisma stays in use for writes and simple reads where it
// happens to work, but complex findMany queries route through here.

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

const cfg = parseUrl(env.DATABASE_URL);

export const pool = mysql.createPool({
  ...cfg,
  waitForConnections: true,
  connectionLimit: 8,
  queueLimit: 0,
  enableKeepAlive: true,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: false,
  supportBigNumbers: true,
  bigNumberStrings: true,
});

export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}
