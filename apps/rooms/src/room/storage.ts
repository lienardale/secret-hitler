/**
 * SQLite storage of one room (Durable Object SQL API, synchronous).
 *
 * Rows written are the free plan's first limit (~100k/day), so the layout
 * keeps writes low: the room is one JSON row, each move is one row (its
 * events included), chat is one row per message.
 */
import { CHAT_HISTORY } from "@sh/protocol";

import type { MoveRow, OutboxItem, StoredChat } from "./room-state";

export type OutboxRow = OutboxItem & {
  attempts: number;
  nextAt: number;
  createdAt: number;
};

export class RoomStore {
  constructor(private readonly sql: SqlStorage) {
    this.init();
  }

  /** Creates the tables (again after `deleteAll`). */
  init(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS moves (
        game INTEGER NOT NULL, idx INTEGER NOT NULL, seat INTEGER, action TEXT,
        events TEXT NOT NULL, at INTEGER NOT NULL, auto INTEGER NOT NULL,
        PRIMARY KEY (game, idx)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tickets (jti TEXT PRIMARY KEY, exp INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
        attempts INTEGER NOT NULL, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL
      ) WITHOUT ROWID;
    `);
  }

  getMeta<T>(key: string): T | null {
    const row = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", key).toArray()[0];
    return row ? (JSON.parse(row.v) as T) : null;
  }

  setMeta(key: string, value: unknown): void {
    this.sql.exec(
      "INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v",
      key,
      JSON.stringify(value),
    );
  }

  deleteMeta(key: string): void {
    this.sql.exec("DELETE FROM meta WHERE k = ?", key);
  }

  loadMoves<A, E>(game: number): MoveRow<A, E>[] {
    return this.sql
      .exec<{
        idx: number;
        seat: number | null;
        action: string | null;
        events: string;
        at: number;
        auto: number;
      }>("SELECT idx, seat, action, events, at, auto FROM moves WHERE game = ? ORDER BY idx", game)
      .toArray()
      .map((row) => ({
        game,
        idx: row.idx,
        seat: row.seat,
        action: row.action === null ? null : (JSON.parse(row.action) as A),
        events: JSON.parse(row.events) as E[],
        at: row.at,
        auto: row.auto === 1,
      }));
  }

  appendMoves<A, E>(rows: readonly MoveRow<A, E>[]): void {
    for (const row of rows) {
      this.sql.exec(
        "INSERT INTO moves (game, idx, seat, action, events, at, auto) VALUES (?, ?, ?, ?, ?, ?, ?)",
        row.game,
        row.idx,
        row.seat,
        row.action === null ? null : JSON.stringify(row.action),
        JSON.stringify(row.events),
        row.at,
        row.auto ? 1 : 0,
      );
    }
  }

  loadChat(): StoredChat[] {
    return this.sql
      .exec<{ body: string }>("SELECT body FROM chat ORDER BY id DESC LIMIT ?", CHAT_HISTORY)
      .toArray()
      .reverse()
      .map((row) => JSON.parse(row.body) as StoredChat);
  }

  appendChat(rows: readonly StoredChat[]): void {
    for (const row of rows) {
      const id = row.message.id;
      this.sql.exec(
        "INSERT OR REPLACE INTO chat (id, body) VALUES (?, ?)",
        id,
        JSON.stringify(row),
      );
      // Trim old messages now and then rather than on every insert.
      if (id % 50 === 0) this.sql.exec("DELETE FROM chat WHERE id <= ?", id - CHAT_HISTORY);
    }
  }

  /** Records a ticket's jti. False if it was already used (replay). */
  useTicket(jti: string, expSeconds: number, now: number): boolean {
    this.sql.exec("DELETE FROM tickets WHERE exp < ?", Math.floor(now / 1000) - 60);
    const cursor = this.sql.exec(
      "INSERT INTO tickets (jti, exp) VALUES (?, ?) ON CONFLICT (jti) DO NOTHING",
      jti,
      expSeconds,
    );
    return cursor.rowsWritten > 0;
  }

  /** Queues items; an id already queued is ignored (a report sent twice is delivered once). */
  addOutbox(items: readonly OutboxItem[], now: number): void {
    for (const item of items) {
      this.sql.exec(
        "INSERT INTO outbox (id, kind, payload, attempts, next_at, created_at) VALUES (?, ?, ?, 0, ?, ?) " +
          "ON CONFLICT (id) DO NOTHING",
        item.id,
        item.kind,
        JSON.stringify(item.payload),
        now,
        now,
      );
    }
  }

  dueOutbox(now: number, limit = 10): OutboxRow[] {
    return this.sql
      .exec<{
        id: string;
        kind: string;
        payload: string;
        attempts: number;
        next_at: number;
        created_at: number;
      }>("SELECT * FROM outbox WHERE next_at <= ? ORDER BY next_at LIMIT ?", now, limit)
      .toArray()
      .map(
        (row) =>
          ({
            id: row.id,
            kind: row.kind,
            payload: JSON.parse(row.payload) as unknown,
            attempts: row.attempts,
            nextAt: row.next_at,
            createdAt: row.created_at,
          }) as OutboxRow,
      );
  }

  removeOutbox(id: string): void {
    this.sql.exec("DELETE FROM outbox WHERE id = ?", id);
  }

  retryOutbox(id: string, attempts: number, nextAt: number): void {
    this.sql.exec("UPDATE outbox SET attempts = ?, next_at = ? WHERE id = ?", attempts, nextAt, id);
  }

  outboxNextAt(): number | null {
    const row = this.sql
      .exec<{ next: number | null }>("SELECT MIN(next_at) AS next FROM outbox")
      .toArray()[0];
    return row?.next ?? null;
  }

  outboxSize(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox").one().n;
  }
}
