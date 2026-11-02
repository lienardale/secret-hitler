/**
 * Prints a room ticket and WebSocket URL for poking at `wrangler dev` by hand.
 *
 *   npm -w @sh/rooms run ticket -- --create                 # new private room + ticket
 *   npm -w @sh/rooms run ticket -- --room BCDFG --name Ada  # ticket for an existing room
 *   npm -w @sh/rooms run ticket -- --create --public --user # public room, account ticket
 *
 * Tickets live 60 seconds and work once.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { DEV_ORIGIN, createRoom, loadDevEnv, mintTicket, roomSocketUrl } from "./dev-env";

const { values: args } = parseArgs({
  options: {
    room: { type: "string" },
    create: { type: "boolean", default: false },
    public: { type: "boolean", default: false },
    user: { type: "boolean", default: false },
    name: { type: "string", default: "Ada" },
    sub: { type: "string" },
    url: { type: "string" },
  },
});

const env = loadDevEnv();
const baseUrl = args.url ?? env.roomsUrl;
const identity = {
  kind: args.user ? ("user" as const) : ("guest" as const),
  sub: args.sub ?? `dev-${randomUUID().slice(0, 8)}`,
  name: args.name,
};

let room = args.room;
if (args.create) {
  room = await createRoom(env, baseUrl, {
    visibility: args.public ? "public" : "private",
    lang: "fr",
    host: identity,
  });
}
if (!room) throw new Error("Pass --room CODE or --create.");

const ticket = await mintTicket(env, room, identity);
const url = roomSocketUrl(baseUrl, room, ticket);
console.log(`room    ${room}`);
console.log(`player  ${identity.name} (${identity.kind}:${identity.sub})`);
console.log(`url     ${url}`);
console.log(`\nnpx wscat -H "Origin: ${DEV_ORIGIN}" -c '${url}'`);
