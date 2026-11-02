/**
 * The rules of a room around the game: joining, seats, host, start, turns
 * and timers, away players, chat, kicks, rematch and when to close.
 *
 * Pure: no I/O and no clock. The GameRoom Durable Object passes the time to
 * every call, persists what `drain()` returns and sends the messages. That
 * keeps every rule testable with a fake clock (test/room-core.test.ts).
 */
import {
  CHAT_HISTORY,
  CLOSE,
  DISPLAY_NAME_MAX,
  MAX_SPECTATORS,
  PROTOCOL_VERSION,
  identityKey,
  nameKey,
  normalizeChatText,
  type ChatMessage,
  type ClientMessage,
  type CloseCode,
  type CreateRoomRequest,
  type ErrorCode,
  type GameResult,
  type GameResultPayload,
  type IdentityKind,
  type LobbyRoomReport,
  type RoomInfo,
  type RoomView,
  type SystemMessageKey,
} from "@sh/protocol";

import type { GameModule, GameSeed, GameViewer } from "../games/types";
import { ChatLimiter, PUBLIC_SLOW_MODE_MS } from "./chat";
import type {
  GameRecord,
  HistoryEntry,
  Member,
  MoveRow,
  Note,
  OutboxItem,
  RoomState,
  StoredChat,
} from "./room-state";

/** Every delay the room applies, in milliseconds. */
export const ROOM_TIMING = {
  /** Public games: a disconnected player is played automatically after this. */
  reconnectGraceMs: 90_000,
  /** Lobby: a disconnected member keeps their seat this long. */
  lobbySeatGraceMs: 60_000,
  /** The host role moves to someone else after the host is gone this long. */
  hostGraceMs: 60_000,
  /** Private games: the host may play the turn of a player gone this long. */
  forceTurnAfterMs: 60_000,
  /** Public games: abandoned when under half of the living players are connected this long. */
  abandonAfterMs: 180_000,
  /** Private games: abandoned when nobody has been connected this long. */
  privateIdleAbandonMs: 6 * 60 * 60_000,
  /** Public lobby: countdown once enough players are seated… */
  countdownMs: 30_000,
  /** …shortened to this when the table is full. */
  fullCountdownMs: 5_000,
  /** Closed this long after a game ends (a rematch reopens the lobby before that). */
  purgeAfterEndMs: 30 * 60_000,
  /** A lobby nobody is connected to is closed after this. */
  purgeEmptyLobbyMs: 30 * 60_000,
} as const;

export const DEFAULT_MIN_PLAYERS = 7;
/** Safety net for automatic play: a whole game takes far fewer moves. */
const MAX_AUTO_MOVES = 2_000;

export interface RoomDeps {
  /** Uniform in [0, 1): seat shuffling and default actions. */
  random: () => number;
  /** Crypto-random game seed. */
  seed: () => GameSeed;
  /** Short random id for a member. */
  pid: () => string;
  uuid: () => string;
}

/** Who is joining, as stated by their verified ticket. */
export interface JoinIdentity {
  kind: IdentityKind;
  sub: string;
  name: string;
  mod: boolean;
  blocks: string[];
}

export type JoinResult = { ok: true; pid: string } | { ok: false; code: CloseCode };

/** Everything a room operation produced, for the Durable Object to persist and send. */
export interface Drained<A, E> {
  notes: Note<E>[];
  moves: MoveRow<A, E>[];
  chat: StoredChat[];
  outbox: OutboxItem[];
  /** The room row changed and must be written. */
  dirty: boolean;
  /** Public rooms: the lobby should hear about this room. */
  lobby: boolean;
}

export interface Loaded<A, E> {
  /** Every event of the current game, oldest first. */
  log: E[];
  history: HistoryEntry<A>[];
  chat: StoredChat[];
  /** Member pids that still have an open WebSocket. */
  online: Iterable<string>;
  now: number;
}

export interface Welcome<V, E> {
  t: "welcome";
  protocol: number;
  you: { pid: string; name: string };
  room: RoomView;
  game: { turn: number; view: V; log: E[] } | null;
  chat: ChatMessage[];
  serverTime: number;
}

export interface GameUpdate<V, E> {
  t: "game";
  turn: number;
  view: V;
  events: E[];
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function createRoomState<S>(
  request: CreateRoomRequest,
  code: string,
  now: number,
): RoomState<S> {
  const requested = request.settings?.timers;
  const timers =
    request.visibility === "public"
      ? requested === undefined || requested === "off"
        ? "standard"
        : requested
      : (requested ?? "off");
  return {
    v: 1,
    code,
    visibility: request.visibility,
    lang: request.lang,
    createdAt: now,
    hostKey: identityKey(request.host.kind, request.host.sub),
    hostAwaySince: now,
    settings: { timers, minPlayers: request.settings?.minPlayers ?? DEFAULT_MIN_PLAYERS },
    members: [],
    seated: [],
    kicked: [],
    status: "lobby",
    startsAt: null,
    game: null,
    result: null,
    endedAt: null,
    emptySince: now,
    gamesPlayed: 0,
  };
}

export class RoomCore<S, A, V, E> {
  /** Every event of the current game (unfiltered). */
  private log: E[];
  private history: HistoryEntry<A>[];
  private chat: StoredChat[];
  private readonly online: Set<string>;
  private readonly limiter = new ChatLimiter();

  private notes: Note<E>[] = [];
  private moves: MoveRow<A, E>[] = [];
  private newChat: StoredChat[] = [];
  private outbox: OutboxItem[] = [];
  private dirty = false;
  /** The lobby report as of the last drain, to flag only real changes. */
  private lobbyJson: string;

  constructor(
    private readonly game: GameModule<S, A, V, E>,
    private readonly deps: RoomDeps,
    readonly room: RoomState<S>,
    loaded: Loaded<A, E>,
  ) {
    this.log = loaded.log;
    this.history = loaded.history;
    this.chat = loaded.chat;
    this.online = new Set(loaded.online);
    this.reconcile(loaded.now);
    this.lobbyJson = JSON.stringify(this.lobbyReport());
  }

  /**
   * After a restart (deploy, eviction) sockets may be gone without a close
   * event: mark their members as gone from now.
   */
  private reconcile(now: number): void {
    for (const member of [...this.room.members]) {
      if (this.online.has(member.pid)) continue;
      if (member.goneSince === null) {
        member.goneSince = now;
        this.dirty = true;
      }
      if (!this.playerPids().includes(member.pid)) {
        this.removeMember(member.pid);
        this.dirty = true;
      }
    }
    for (const pid of [...this.online]) if (!this.member(pid)) this.online.delete(pid);
    if (this.online.size === 0 && this.room.emptySince === null) {
      this.room.emptySince = now;
      this.dirty = true;
    }
    this.updatePresence(now);
  }

  // ── Lookups ────────────────────────────────────────────────────────────

  member(pid: string): Member | undefined {
    return this.room.members.find((m) => m.pid === pid);
  }

  private memberByKey(key: string): Member | undefined {
    return this.room.members.find((m) => m.key === key);
  }

  isOnline(pid: string): boolean {
    return this.online.has(pid);
  }

  /** Lobby: seated members. During and after a game: seat number → pid. */
  playerPids(): string[] {
    return this.room.status === "lobby" ? this.room.seated : (this.room.game?.seats ?? []);
  }

  /** Seat of a member in the current game, or -1. */
  seatOf(pid: string): number {
    return this.room.status === "lobby" ? -1 : (this.room.game?.seats.indexOf(pid) ?? -1);
  }

  private spectatorPids(): string[] {
    const players = new Set(this.playerPids());
    return this.room.members
      .filter((m) => !players.has(m.pid) && this.online.has(m.pid))
      .map((m) => m.pid);
  }

  private isHost(member: Member): boolean {
    return member.key === this.room.hostKey;
  }

  private viewerOf(pid: string): GameViewer {
    const seat = this.seatOf(pid);
    return seat >= 0 ? seat : "spectator";
  }

  private touch(): void {
    this.dirty = true;
    this.notes.push({ kind: "room" });
  }

  // ── Presence ───────────────────────────────────────────────────────────

  join(identity: JoinIdentity, now: number): JoinResult {
    const room = this.room;
    const key = identityKey(identity.kind, identity.sub);
    if (room.kicked.includes(key)) return { ok: false, code: CLOSE.kicked };
    if (room.visibility === "public" && identity.kind === "guest") {
      return { ok: false, code: CLOSE.accountRequired };
    }

    let member = this.memberByKey(key);
    if (member) {
      member.blocks = identity.blocks;
      member.mod = identity.mod;
      if (member.goneSince !== null) {
        member.goneSince = null;
        const seat = this.seatOf(member.pid);
        if (room.status === "playing" && room.game && seat >= 0 && room.game.auto[seat]) {
          room.game.auto[seat] = false;
          this.system("playerBack", { name: member.name }, now);
        }
      }
    } else {
      const seatFree = room.status === "lobby" && room.seated.length < this.game.maxPlayers;
      if (!seatFree && !identity.mod && this.spectatorPids().length >= MAX_SPECTATORS) {
        return { ok: false, code: CLOSE.roomFull };
      }
      member = {
        pid: this.newPid(),
        key,
        kind: identity.kind,
        sub: identity.sub,
        name: this.uniqueName(identity.name),
        mod: identity.mod,
        blocks: identity.blocks,
        joinedAt: now,
        goneSince: null,
      };
      room.members.push(member);
      if (seatFree) room.seated.push(member.pid);
      this.system("playerJoined", { name: member.name }, now);
    }

    this.online.add(member.pid);
    room.emptySince = null;
    room.hostKey ??= key;
    this.updatePresence(now);
    this.touch();
    return { ok: true, pid: member.pid };
  }

  /** The member's last tab closed. */
  markGone(pid: string, now: number): void {
    this.online.delete(pid);
    const member = this.member(pid);
    if (!member) return;
    member.goneSince = now;
    // Spectators leave when their last tab closes; they come back as new spectators.
    if (!this.playerPids().includes(pid)) this.removeMember(pid);
    if (this.online.size === 0) this.room.emptySince = now;
    this.updatePresence(now);
    this.touch();
  }

  private removeMember(pid: string): void {
    this.room.members = this.room.members.filter((m) => m.pid !== pid);
    this.room.seated = this.room.seated.filter((p) => p !== pid);
    this.online.delete(pid);
  }

  /** Host away timer, public countdown and the abandon timer depend on who is connected. */
  private updatePresence(now: number): void {
    const room = this.room;
    const host = room.hostKey === null ? undefined : this.memberByKey(room.hostKey);
    if (host && this.online.has(host.pid)) room.hostAwaySince = null;
    else room.hostAwaySince ??= now;

    const game = room.game;
    if (room.status === "playing" && room.visibility === "public" && game) {
      const living = game.seats.filter((_, seat) => this.game.isAlive(game.state, seat));
      const connected = living.filter((pid) => this.online.has(pid)).length;
      if (connected * 2 < living.length) game.underHalfSince ??= now;
      else game.underHalfSince = null;
    }
    this.refreshCountdown(now);
    this.dirty = true;
  }

  private newPid(): string {
    for (;;) {
      const pid = this.deps.pid();
      if (!this.member(pid)) return pid;
    }
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.room.members.map((m) => nameKey(m.name)));
    if (!taken.has(nameKey(name))) return name;
    for (let n = 2; ; n++) {
      const suffix = ` ${n}`;
      const candidate = `${name.slice(0, DISPLAY_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
      if (!taken.has(nameKey(candidate))) return candidate;
    }
  }

  // ── Client messages ────────────────────────────────────────────────────

  /** Applies one message from a member. Returns an error code, or null when it was accepted. */
  handle(pid: string, msg: Exclude<ClientMessage, { t: "sync" }>, now: number): ErrorCode | null {
    const member = this.member(pid);
    if (!member) return "unknown_member";
    const room = this.room;

    switch (msg.t) {
      case "sit": {
        if (room.status !== "lobby") return "wrong_status";
        if (room.seated.includes(pid)) return "already_seated";
        if (room.seated.length >= this.game.maxPlayers) return "room_full";
        room.seated.push(pid);
        this.refreshCountdown(now);
        this.touch();
        return null;
      }
      case "stand": {
        if (room.status !== "lobby") return "wrong_status";
        if (!room.seated.includes(pid)) return "not_seated";
        room.seated = room.seated.filter((p) => p !== pid);
        this.refreshCountdown(now);
        this.touch();
        return null;
      }
      case "settings": {
        if (!this.isHost(member)) return "not_host";
        if (room.status !== "lobby") return "wrong_status";
        if (msg.timers === "off" && room.visibility === "public") return "invalid_message";
        if (msg.timers !== undefined) room.settings.timers = msg.timers;
        if (msg.minPlayers !== undefined) room.settings.minPlayers = msg.minPlayers;
        this.refreshCountdown(now);
        this.touch();
        return null;
      }
      case "start": {
        if (!this.isHost(member)) return "not_host";
        if (room.visibility !== "private") return "private_only";
        if (room.status !== "lobby") return "wrong_status";
        const count = room.seated.length;
        if (count < this.game.minPlayers || count > this.game.maxPlayers) {
          return "not_enough_players";
        }
        if (!room.seated.every((p) => this.online.has(p))) return "players_disconnected";
        this.startGame(now);
        return null;
      }
      case "kick":
        return this.kick(member, msg.pid, now);
      case "action": {
        if (room.status !== "playing" || !room.game) return "wrong_status";
        const seat = this.seatOf(pid);
        if (seat < 0) return "not_a_player";
        if (msg.turn !== room.game.turn) return "stale_turn";
        const action = this.game.parseAction(msg.action);
        if (action === null) return "invalid_message";
        const error = this.applyMove(seat, action, false, now);
        if (error !== null) return error as ErrorCode;
        this.autoPlay(now);
        return null;
      }
      case "chat":
        return this.postChat(member, msg.text, now);
      case "forceTurn":
        return this.forceTurn(member, msg.pid, now);
      case "endGame": {
        if (!this.isHost(member)) return "not_host";
        if (room.visibility !== "private") return "private_only";
        if (room.status !== "playing") return "wrong_status";
        this.finishGame({ kind: "abandoned" }, [], now);
        return null;
      }
      case "rematch": {
        if (!this.isHost(member)) return "not_host";
        if (room.status !== "ended") return "wrong_status";
        this.rematch(now);
        return null;
      }
    }
  }

  private kick(host: Member, targetPid: string, now: number): ErrorCode | null {
    if (!this.isHost(host)) return "not_host";
    const target = this.member(targetPid);
    if (!target) return "unknown_member";
    if (target.pid === host.pid) return "invalid_message";
    const room = this.room;
    room.kicked.push(target.key);
    this.notes.push({ kind: "close", pid: target.pid, code: CLOSE.kicked });
    this.online.delete(target.pid);
    const seat = this.seatOf(target.pid);
    if (seat >= 0) {
      // A kicked player keeps their seat in the game record; the room plays for them.
      target.goneSince = now;
      if (room.status === "playing" && room.game) room.game.auto[seat] = true;
    } else {
      this.removeMember(target.pid);
    }
    this.system("playerKicked", { name: target.name }, now);
    this.updatePresence(now);
    this.touch();
    if (room.status === "playing") this.autoPlay(now);
    return null;
  }

  private forceTurn(host: Member, targetPid: string, now: number): ErrorCode | null {
    const room = this.room;
    if (!this.isHost(host)) return "not_host";
    if (room.visibility !== "private") return "private_only";
    if (room.status !== "playing" || !room.game) return "wrong_status";
    const target = this.member(targetPid);
    const seat = target ? this.seatOf(target.pid) : -1;
    if (!target || seat < 0) return "unknown_member";
    if (target.goneSince === null || now - target.goneSince < ROOM_TIMING.forceTurnAfterMs) {
      return "not_disconnected_long_enough";
    }
    const state = room.game.state;
    const action = this.game.pendingActors(state).includes(seat)
      ? this.game.defaultAction(state, seat, this.deps.random)
      : null;
    if (action === null) return "not_their_turn";
    this.system("turnForced", { name: target.name }, now);
    const error = this.applyMove(seat, action, true, now);
    this.autoPlay(now);
    return error as ErrorCode | null;
  }

  // ── Chat ───────────────────────────────────────────────────────────────

  private canChat(member: Member): boolean {
    const room = this.room;
    if (room.status !== "playing" || !room.game) return true;
    const seat = this.seatOf(member.pid);
    return this.game.canChat(room.game.state, seat >= 0 ? seat : null);
  }

  private postChat(member: Member, raw: string, now: number): ErrorCode | null {
    if (!this.canChat(member)) return "chat_not_allowed";
    const text = normalizeChatText(raw);
    if (text === null) return "chat_invalid";
    const slowMode = this.room.visibility === "public" ? PUBLIC_SLOW_MODE_MS : 0;
    const verdict = this.limiter.check(member.pid, now, slowMode);
    if (verdict === "flood") {
      this.notes.push({ kind: "close", pid: member.pid, code: CLOSE.flood });
      return "chat_too_fast";
    }
    if (verdict === "too_fast") return "chat_too_fast";
    this.addChat(
      { kind: "player", id: this.nextChatId(), at: now, pid: member.pid, name: member.name, text },
      member.key,
    );
    return null;
  }

  private nextChatId(): number {
    return (this.chat.at(-1)?.message.id ?? 0) + 1;
  }

  private system(key: SystemMessageKey, params: Record<string, string>, now: number): void {
    this.addChat({ kind: "system", id: this.nextChatId(), at: now, key, params }, null);
  }

  private addChat(message: ChatMessage, authorKey: string | null): void {
    const stored = { message, authorKey };
    this.chat.push(stored);
    if (this.chat.length > CHAT_HISTORY) this.chat = this.chat.slice(-CHAT_HISTORY);
    this.newChat.push(stored);
    this.notes.push({ kind: "chat", chat: stored });
  }

  /** Blocks: a member never sees messages from identities they blocked. */
  chatVisibleTo(stored: StoredChat, pid: string): boolean {
    const member = this.member(pid);
    return stored.authorKey === null || !member?.blocks.includes(stored.authorKey);
  }

  // ── Game flow ──────────────────────────────────────────────────────────

  private deadline(state: S, now: number): number | null {
    const ms = this.game.decisionMs(state, this.room.settings.timers);
    return ms === null ? null : now + ms;
  }

  private startGame(now: number): void {
    const room = this.room;
    const seats = shuffle(room.seated, this.deps.random);
    const seed = this.deps.seed();
    const { state, events } = this.game.setup(seats.length, seed);
    const number = room.gamesPlayed + 1;
    const game: GameRecord<S> = {
      id: this.deps.uuid(),
      number,
      startedAt: now,
      seed,
      seats,
      state,
      nextMove: 1,
      turn: 1,
      phaseKey: this.game.phaseKey(state),
      deadline: this.deadline(state, now),
      auto: seats.map(() => false),
      underHalfSince: null,
    };
    room.game = game;
    room.gamesPlayed = number;
    room.status = "playing";
    room.seated = [];
    room.startsAt = null;
    room.result = null;
    room.endedAt = null;
    this.log = [...events];
    this.history = [];
    this.moves.push({
      game: number,
      idx: 0,
      seat: null,
      action: null,
      events,
      at: now,
      auto: false,
    });
    this.system("gameStarted", {}, now);
    this.touch();
    this.notes.push({ kind: "snapshot" });
    this.updatePresence(now);
  }

  private applyMove(seat: number, action: A, auto: boolean, now: number): string | null {
    const game = this.room.game;
    if (!game) return "wrong_status";
    const result = this.game.apply(game.state, seat, action);
    if (!result.ok) return result.code;

    game.state = result.state;
    const idx = game.nextMove++;
    this.log.push(...result.events);
    this.history.push({ seat, action, at: now, auto });
    this.moves.push({ game: game.number, idx, seat, action, events: result.events, at: now, auto });
    this.notes.push({ kind: "game", events: result.events });
    this.dirty = true;

    const end = this.game.result(game.state);
    if (end) {
      this.finishGame(end.result, end.winners, now);
      return null;
    }
    const key = this.game.phaseKey(game.state);
    if (key !== game.phaseKey) {
      game.phaseKey = key;
      game.turn += 1;
      game.deadline = this.deadline(game.state, now);
      this.touch();
    }
    this.updatePresence(now);
    return null;
  }

  /**
   * Plays default actions for seats the room plays (away or kicked), and for
   * everyone still pending once the deadline has passed.
   */
  private autoPlay(now: number): void {
    for (let i = 0; i < MAX_AUTO_MOVES; i++) {
      const game = this.room.game;
      if (this.room.status !== "playing" || !game) return;
      const pending = this.game.pendingActors(game.state);
      const timedOut = game.deadline !== null && game.deadline <= now;
      const seat = pending.find((s) => game.auto[s]) ?? (timedOut ? pending[0] : undefined);
      if (seat === undefined) return;
      const action = this.game.defaultAction(game.state, seat, this.deps.random);
      if (action === null || this.applyMove(seat, action, true, now) !== null) return;
    }
  }

  private finishGame(result: GameResult, winners: number[], now: number): void {
    const room = this.room;
    const game = room.game;
    if (!game) return;
    room.status = "ended";
    room.result = result;
    room.endedAt = now;
    room.startsAt = null;
    game.deadline = null;
    game.underHalfSince = null;
    this.outbox.push({
      id: this.deps.uuid(),
      kind: "gameResult",
      payload: this.resultPayload(game, result, winners, now),
    });
    this.system(result.kind === "finished" ? "gameEnded" : "gameAbandoned", {}, now);
    this.touch();
  }

  private resultPayload(
    game: GameRecord<S>,
    result: GameResult,
    winners: number[],
    now: number,
  ): GameResultPayload {
    return {
      gameId: game.id,
      room: this.room.code,
      visibility: this.room.visibility,
      lang: this.room.lang,
      number: game.number,
      startedAt: game.startedAt,
      endedAt: now,
      result,
      players: game.seats.map((pid, seat) => {
        const member = this.member(pid);
        return {
          seat,
          kind: member?.kind ?? "guest",
          sub: member?.sub ?? "unknown",
          name: member?.name ?? "?",
          role: this.game.roleOf(game.state, seat),
          alive: this.game.isAlive(game.state, seat),
          won: result.kind === "finished" && winners.includes(seat),
        };
      }),
      log: {
        game: this.game.id,
        stateVersion: this.game.stateVersion,
        seed: [...game.seed] as [number, number, number, number],
        // The module's actions are Secret Hitler actions (the only game today).
        moves: this.history as unknown as GameResultPayload["log"]["moves"],
      },
    };
  }

  private rematch(now: number): void {
    const room = this.room;
    const previous = room.game?.seats ?? [];
    room.members = room.members.filter((m) => this.online.has(m.pid));
    room.status = "lobby";
    room.seated = previous.filter((pid) => this.online.has(pid)).slice(0, this.game.maxPlayers);
    room.game = null;
    room.result = null;
    room.endedAt = null;
    this.log = [];
    this.history = [];
    this.touch();
    this.notes.push({ kind: "snapshot" });
    this.updatePresence(now);
  }

  /** Public lobby: start countdown while enough connected players are seated. */
  private refreshCountdown(now: number): void {
    const room = this.room;
    let next: number | null = null;
    if (room.status === "lobby" && room.visibility === "public") {
      const ready = room.seated.filter((pid) => this.online.has(pid)).length;
      if (ready >= room.settings.minPlayers) {
        const full = ready >= this.game.maxPlayers;
        const target = now + (full ? ROOM_TIMING.fullCountdownMs : ROOM_TIMING.countdownMs);
        next = room.startsAt === null ? target : Math.min(room.startsAt, target);
      }
    }
    if (next !== room.startsAt) {
      room.startsAt = next;
      this.touch();
    }
  }

  // ── Time ───────────────────────────────────────────────────────────────

  /**
   * Runs everything that is due: lobby seat expiry, host hand-over, away
   * players, abandon rules, the public start countdown and turn deadlines.
   * The Durable Object calls it after every operation and on its alarm.
   */
  tick(now: number): void {
    const room = this.room;
    if (room.status === "lobby") {
      for (const pid of [...room.seated]) {
        const member = this.member(pid);
        if (member?.goneSince != null && now - member.goneSince >= ROOM_TIMING.lobbySeatGraceMs) {
          this.removeMember(pid);
          this.system("playerLeft", { name: member.name }, now);
          this.touch();
        }
      }
    }
    this.handOverHost(now);
    if (room.status === "playing") this.tickGame(now);
    if (room.status === "lobby" && room.startsAt !== null && now >= room.startsAt) {
      this.autoStart(now);
    }
    this.refreshCountdown(now);
  }

  private handOverHost(now: number): void {
    const room = this.room;
    if (room.hostAwaySince === null || now - room.hostAwaySince < ROOM_TIMING.hostGraceMs) return;
    const players = new Set(this.playerPids());
    const next = room.members
      .filter((m) => this.online.has(m.pid))
      .sort(
        (a, b) =>
          Number(players.has(b.pid)) - Number(players.has(a.pid)) || a.joinedAt - b.joinedAt,
      )[0];
    if (!next) return;
    room.hostKey = next.key;
    room.hostAwaySince = null;
    this.system("hostChanged", { name: next.name }, now);
    this.touch();
  }

  private tickGame(now: number): void {
    const room = this.room;
    const game = room.game;
    if (!game) return;
    if (room.visibility === "public") {
      game.seats.forEach((pid, seat) => {
        const member = this.member(pid);
        if (
          !game.auto[seat] &&
          member?.goneSince != null &&
          now - member.goneSince >= ROOM_TIMING.reconnectGraceMs &&
          this.game.isAlive(game.state, seat)
        ) {
          game.auto[seat] = true;
          this.system("playerAfk", { name: member.name }, now);
          this.touch();
        }
      });
      if (game.underHalfSince !== null && now - game.underHalfSince >= ROOM_TIMING.abandonAfterMs) {
        this.finishGame({ kind: "abandoned" }, [], now);
        return;
      }
    } else if (
      room.emptySince !== null &&
      now - room.emptySince >= ROOM_TIMING.privateIdleAbandonMs
    ) {
      this.finishGame({ kind: "abandoned" }, [], now);
      return;
    }
    this.autoPlay(now);
  }

  private autoStart(now: number): void {
    const room = this.room;
    room.seated = room.seated.filter((pid) => this.online.has(pid));
    if (room.seated.length >= room.settings.minPlayers) this.startGame(now);
    else {
      room.startsAt = null;
      this.touch();
    }
  }

  /** When the room is closed for good (the Durable Object then deletes its storage). */
  purgeAt(): number | null {
    const room = this.room;
    if (room.status === "ended" && room.endedAt !== null) {
      return room.endedAt + ROOM_TIMING.purgeAfterEndMs;
    }
    if (room.status === "lobby" && room.emptySince !== null) {
      return room.emptySince + ROOM_TIMING.purgeEmptyLobbyMs;
    }
    return null;
  }

  /** The next time `tick` has something to do (strictly after `now`), or null. */
  nextWakeup(now: number): number | null {
    const room = this.room;
    const times: (number | null)[] = [this.purgeAt(), room.startsAt];
    if (room.hostAwaySince !== null) times.push(room.hostAwaySince + ROOM_TIMING.hostGraceMs);
    if (room.status === "lobby") {
      for (const pid of room.seated) {
        const gone = this.member(pid)?.goneSince;
        if (gone != null) times.push(gone + ROOM_TIMING.lobbySeatGraceMs);
      }
    }
    const game = room.game;
    if (room.status === "playing" && game) {
      times.push(game.deadline);
      if (room.visibility === "public") {
        if (game.underHalfSince !== null) {
          times.push(game.underHalfSince + ROOM_TIMING.abandonAfterMs);
        }
        game.seats.forEach((pid, seat) => {
          const gone = this.member(pid)?.goneSince;
          if (gone != null && !game.auto[seat]) times.push(gone + ROOM_TIMING.reconnectGraceMs);
        });
      } else if (room.emptySince !== null) {
        times.push(room.emptySince + ROOM_TIMING.privateIdleAbandonMs);
      }
    }
    const future = times.filter((t): t is number => t !== null && t > now);
    return future.length > 0 ? Math.min(...future) : null;
  }

  // ── Output ─────────────────────────────────────────────────────────────

  /** Takes everything produced since the last call. Notes are merged so each client gets one message per kind. */
  drain(): Drained<A, E> {
    const notes = this.notes;
    const closes = notes.filter((n) => n.kind === "close");
    let merged: Note<E>[];
    if (notes.some((n) => n.kind === "snapshot")) {
      // A snapshot carries the room, the game and the chat history.
      merged = [{ kind: "snapshot" }, ...closes];
    } else {
      const events = notes.flatMap((n) => (n.kind === "game" ? n.events : []));
      merged = [
        ...(notes.some((n) => n.kind === "room") ? [{ kind: "room" } as const] : []),
        ...(notes.some((n) => n.kind === "game") ? [{ kind: "game", events } as const] : []),
        ...notes.filter((n) => n.kind === "chat"),
        ...closes,
      ];
    }
    const lobbyJson = JSON.stringify(this.lobbyReport());
    const out: Drained<A, E> = {
      notes: merged,
      moves: this.moves,
      chat: this.newChat,
      outbox: this.outbox,
      dirty: this.dirty,
      lobby: lobbyJson !== this.lobbyJson,
    };
    this.lobbyJson = lobbyJson;
    this.notes = [];
    this.moves = [];
    this.newChat = [];
    this.outbox = [];
    this.dirty = false;
    return out;
  }

  roomView(): RoomView {
    const room = this.room;
    const host = room.hostKey === null ? undefined : this.memberByKey(room.hostKey);
    const game = room.status === "lobby" ? null : room.game;
    return {
      code: room.code,
      visibility: room.visibility,
      lang: room.lang,
      status: room.status,
      settings: { ...room.settings },
      hostPid: host?.pid ?? null,
      players: this.playerPids().map((pid, seat) => {
        const member = this.member(pid);
        return {
          pid,
          name: member?.name ?? "?",
          guest: member?.kind === "guest",
          connected: this.online.has(pid),
          afk: game?.auto[seat] ?? false,
        };
      }),
      spectators: this.spectatorPids().map((pid) => {
        const member = this.member(pid) as Member;
        return { pid, name: member.name, guest: member.kind === "guest", connected: true };
      }),
      startsAt: room.startsAt,
      game: game ? { number: game.number, turn: game.turn, deadline: game.deadline } : null,
      result: room.result,
    };
  }

  welcomeFor(pid: string, now: number): Welcome<V, E> | null {
    const member = this.member(pid);
    if (!member) return null;
    const game = this.room.status === "lobby" ? null : this.room.game;
    const viewer = this.viewerOf(pid);
    return {
      t: "welcome",
      protocol: PROTOCOL_VERSION,
      you: { pid, name: member.name },
      room: this.roomView(),
      game: game
        ? {
            turn: game.turn,
            view: this.game.view(game.state, viewer),
            log: this.game.eventsFor(this.log, viewer),
          }
        : null,
      chat: this.chat.filter((c) => this.chatVisibleTo(c, pid)).map((c) => c.message),
      serverTime: now,
    };
  }

  gameUpdateFor(pid: string, events: readonly E[]): GameUpdate<V, E> | null {
    const game = this.room.game;
    if (!game || this.room.status === "lobby" || !this.member(pid)) return null;
    const viewer = this.viewerOf(pid);
    return {
      t: "game",
      turn: game.turn,
      view: this.game.view(game.state, viewer),
      events: this.game.eventsFor(events, viewer),
    };
  }

  /** Public rooms that can be listed (lobby or playing), for the lobby. */
  lobbyReport(): LobbyRoomReport | null {
    const room = this.room;
    if (room.visibility !== "public" || room.status === "ended") return null;
    return {
      code: room.code,
      lang: room.lang,
      status: room.status,
      players: this.playerPids().length,
      maxPlayers: this.game.maxPlayers,
      minPlayers: room.settings.minPlayers,
      timers: room.settings.timers,
      startsAt: room.startsAt,
      members: room.members.map((m) => m.key).slice(0, 40),
    };
  }

  info(): RoomInfo {
    return {
      code: this.room.code,
      visibility: this.room.visibility,
      lang: this.room.lang,
      status: this.room.status,
      players: this.playerPids().length,
      spectators: this.spectatorPids().length,
    };
  }
}
