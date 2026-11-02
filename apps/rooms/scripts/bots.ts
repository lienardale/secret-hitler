/**
 * Dev bots: N guests who create (or join) a room over real WebSockets and
 * play random legal moves until the game ends. They reconnect like the
 * browser will (partysocket, a fresh ticket per attempt).
 *
 *   npm run dev:rooms                                # wrangler dev on :8787, in another terminal
 *   npm -w @sh/rooms run bots -- --players 7 --timers fast
 *   npm -w @sh/rooms run bots -- --players 7 --kill-one   # cut one bot's connection mid-game
 *   npm -w @sh/rooms run bots -- --room BCDFG --players 4 # fill a room you created
 *
 * Exits with status 1 if the game does not finish, the bots disagree on the
 * result, or a killed bot does not get its seat back.
 */
import { parseArgs } from "node:util";

import { seededRandom, type Action, type PlayerView } from "@sh/engine";
import {
  KEEPALIVE_PING,
  RETRYABLE_CLOSE_CODES,
  TIMER_PRESETS,
  serverMessageSchema,
  type RoomView,
  type ServerMessage,
  type TimerPreset,
} from "@sh/protocol";
import ReconnectingWebSocket from "partysocket/ws";
import WebSocket from "ws";

import {
  DEV_ORIGIN,
  createRoom,
  loadDevEnv,
  mintTicket,
  roomSocketUrl,
  type DevIdentity,
} from "./dev-env";

const { values: args } = parseArgs({
  options: {
    players: { type: "string", default: "7" },
    timers: { type: "string", default: "fast" },
    url: { type: "string" },
    room: { type: "string" },
    "kill-one": { type: "boolean", default: false },
    think: { type: "string", default: "250" },
    seed: { type: "string", default: String(Date.now() % 100_000) },
    timeout: { type: "string", default: "300" },
  },
});

const players = Number(args.players);
const timers = args.timers as TimerPreset;
const thinkMs = Number(args.think);
const rand = seededRandom(Number(args.seed));
if (!Number.isInteger(players) || players < 1 || players > 10)
  throw new Error("--players must be 1 to 10");
if (!TIMER_PRESETS.includes(timers))
  throw new Error(`--timers must be one of ${TIMER_PRESETS.join(", ")}`);

const env = loadDevEnv();
const baseUrl = args.url ?? env.roomsUrl;
const started = performance.now();

const log = (who: string, message: string) => {
  const seconds = ((performance.now() - started) / 1000).toFixed(1).padStart(6);
  console.log(`${seconds}s ${who.padEnd(7)} ${message}`);
};

class Bot {
  readonly name: string;
  readonly identity: DevIdentity;
  room: RoomView | null = null;
  view: PlayerView | null = null;
  turn = 0;
  pid = "";
  welcomes = 0;
  errors: string[] = [];
  /** Seat before the connection was cut, to check the bot gets it back. */
  seatBeforeKill: number | null = null;
  rejoinedSeat: number | null = null;
  private raw: WebSocket | null = null;
  private socket: ReconnectingWebSocket | null = null;
  private sentAt: { turn: number; seq: number } | null = null;
  private thinking = false;
  private startSent = false;
  private keepAlive: NodeJS.Timeout | null = null;

  constructor(
    readonly index: number,
    readonly code: string,
    readonly isHost: boolean,
  ) {
    this.name = `Bot ${index}`;
    this.identity = { kind: "guest", sub: `bot-${index}`, name: this.name };
  }

  start(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the socket class needs the bot
    const bot = this;
    class OriginWebSocket extends WebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols, { headers: { Origin: DEV_ORIGIN } });
        bot.raw = this;
      }
    }
    this.socket = new ReconnectingWebSocket(
      async () =>
        roomSocketUrl(baseUrl, this.code, await mintTicket(env, this.code, this.identity)),
      [],
      {
        WebSocket: OriginWebSocket,
        minReconnectionDelay: 300 + rand() * 500,
        maxReconnectionDelay: 4000,
        maxRetries: 30,
        maxEnqueuedMessages: 0,
        shouldReconnectOnClose: (event) => RETRYABLE_CLOSE_CODES.has(event.code),
      },
    );
    this.socket.addEventListener("message", (event) => this.receive(String(event.data)));
    this.socket.addEventListener("close", (event) => {
      if (!RETRYABLE_CLOSE_CODES.has(event.code) && event.code !== 1000) {
        log(this.name, `closed for good: ${event.code} ${event.reason}`);
      }
    });
    this.keepAlive = setInterval(() => this.socket?.send(KEEPALIVE_PING), 30_000);
  }

  private receive(data: string): void {
    if (data === "pong") return;
    const message: ServerMessage = serverMessageSchema.parse(JSON.parse(data));
    switch (message.t) {
      case "welcome":
        this.welcomes += 1;
        this.pid = message.you.pid;
        this.room = message.room;
        this.view = message.game?.view ?? null;
        this.turn = message.game?.turn ?? 0;
        this.sentAt = null;
        if (this.seatBeforeKill !== null && this.welcomes > 1) {
          this.rejoinedSeat = this.view?.me?.seat ?? null;
          log(this.name, `reconnected as ${this.pid}, seat ${this.rejoinedSeat}`);
        }
        break;
      case "room":
        this.room = message.room;
        if (message.room.game) this.turn = message.room.game.turn;
        break;
      case "game":
        this.view = message.view;
        this.turn = message.turn;
        break;
      case "error":
        this.errors.push(message.code);
        log(this.name, `refused: ${message.code}`);
        this.sentAt = null;
        break;
      case "chat":
        break;
    }
    this.maybeAct();
  }

  private maybeAct(): void {
    const room = this.room;
    if (
      this.isHost &&
      !this.startSent &&
      room?.status === "lobby" &&
      room.players.length === players &&
      room.players.every((p) => p.connected)
    ) {
      this.startSent = true;
      log(this.name, "starting the game");
      this.send({ t: "start" });
    }
    const view = this.view;
    if (!view?.me?.legal.length || this.thinking) return;
    if (this.sentAt && this.sentAt.turn === this.turn && this.sentAt.seq === view.seq) return;
    this.thinking = true;
    setTimeout(
      () => {
        this.thinking = false;
        const legal = this.view?.me?.legal ?? [];
        if (legal.length === 0 || !this.view) return;
        const action = legal[Math.floor(rand() * legal.length)] as Action;
        this.sentAt = { turn: this.turn, seq: this.view.seq };
        this.send({ t: "action", turn: this.turn, action });
      },
      30 + rand() * thinkMs,
    );
  }

  private send(message: object): void {
    this.socket?.send(JSON.stringify(message));
  }

  /** Cuts the TCP connection without a close frame, like a phone losing signal. */
  kill(): void {
    this.seatBeforeKill = this.view?.me?.seat ?? null;
    log(this.name, `connection cut (seat ${this.seatBeforeKill})`);
    this.raw?.terminate();
  }

  stop(): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.socket?.close(1000, "bot done");
  }
}

async function main(): Promise<number> {
  const health = await fetch(new URL("/health", baseUrl)).catch(() => null);
  if (!health?.ok) {
    console.error(`No rooms Worker at ${baseUrl}. Start it with \`npm run dev:rooms\`.`);
    return 1;
  }

  const code =
    args.room ??
    (await createRoom(env, baseUrl, {
      visibility: "private",
      lang: "fr",
      host: { kind: "guest", sub: "bot-1", name: "Bot 1" },
      settings: { timers },
    }));
  log("room", `${code} (${players} bots, timers ${timers})`);

  const bots = Array.from(
    { length: players },
    (_, i) => new Bot(i + 1, code, !args.room && i === 0),
  );
  for (const bot of bots) {
    bot.start();
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const deadline = performance.now() + Number(args.timeout) * 1000;
  let killed: Bot | null = null;
  while (performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const lead = bots[0] as Bot;
    if (args["kill-one"] && !killed && (lead.view?.seq ?? 0) >= 15) {
      const candidates = bots.filter((b) => !b.isHost && b.view?.me);
      killed = candidates[Math.floor(rand() * candidates.length)] ?? null;
      killed?.kill();
    }
    if (bots.every((b) => b.room?.status === "ended")) break;
  }

  const results = new Set(bots.map((b) => JSON.stringify(b.room?.result ?? null)));
  const result = bots[0]?.room?.result;
  const ended = bots.every((b) => b.room?.status === "ended");
  const rejoinOk =
    !killed || (killed.rejoinedSeat !== null && killed.rejoinedSeat === killed.seatBeforeKill);
  for (const bot of bots) bot.stop();

  console.log("");
  console.log(`room        ${code}`);
  console.log(`finished    ${ended ? "yes" : "NO (timeout)"}`);
  console.log(`result      ${JSON.stringify(result ?? null)}`);
  console.log(`moves       ${bots[0]?.view?.seq ?? 0}`);
  console.log(
    `agreement   ${results.size === 1 ? "all bots saw the same result" : "BOTS DISAGREE"}`,
  );
  if (killed)
    console.log(
      `reconnect   ${killed.name}: ${rejoinOk ? "got its seat back" : "DID NOT get its seat back"}`,
    );
  const refused = bots.flatMap((b) => b.errors);
  console.log(`refusals    ${refused.length === 0 ? "none" : refused.join(", ")}`);
  return ended && results.size === 1 && rejoinOk ? 0 : 1;
}

process.exit(await main());
