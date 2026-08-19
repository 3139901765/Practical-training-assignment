import { DatabaseSync } from 'node:sqlite';

export function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}
