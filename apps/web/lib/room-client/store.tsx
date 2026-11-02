"use client";

/**
 * React bindings: one store and one connection per mounted room.
 *
 *   <RoomProvider code="BCDFG">…</RoomProvider>
 *   const room = useRoomState((s) => s.room);
 *   const { send, act, reconnect } = useRoomActions();
 *   const { muted, setMuted } = useMuted();
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Action } from "@sh/engine";
import type { ClientMessage } from "@sh/protocol";
import { createStore, useStore, type StoreApi } from "zustand";

import { connectRoom, type RoomConnection } from "./connection";
import { browserStorage, loadMuted, saveMuted, withMuted } from "./mute";
import { initialRoomState, reduce, type RoomClientState } from "./state";

interface RoomContextValue {
  store: StoreApi<RoomClientState>;
  connection: RefObject<RoomConnection | null>;
}

const RoomContext = createContext<RoomContextValue | null>(null);

// ------------------------------------------------------------------ mute ----

export interface MutedMembers {
  /** Room ids (`pid`) whose chat messages this browser hides. */
  muted: ReadonlySet<string>;
  setMuted(pid: string, on: boolean): void;
}

const MutedContext = createContext<MutedMembers | null>(null);

/** Muted members of room `code`, kept in this browser (lib/room-client/mute.ts). */
function MutedProvider({ code, children }: { code: string | null; children: ReactNode }) {
  const [muted, setMutedSet] = useState<ReadonlySet<string>>(() =>
    code ? loadMuted(browserStorage(), code) : new Set(),
  );
  const changed = useRef(false);

  useEffect(() => {
    // Write only what the player changed, never the list just read.
    if (code && changed.current) saveMuted(browserStorage(), code, muted);
  }, [code, muted]);

  const setMuted = useCallback((pid: string, on: boolean) => {
    changed.current = true;
    setMutedSet((current) => withMuted(current, pid, on));
  }, []);

  const value = useMemo(() => ({ muted, setMuted }), [muted, setMuted]);
  return <MutedContext.Provider value={value}>{children}</MutedContext.Provider>;
}

export function useMuted(): MutedMembers {
  const value = useContext(MutedContext);
  if (!value) throw new Error("useMuted must be used inside <RoomProvider>");
  return value;
}

// ------------------------------------------------------------------ room ----

export function RoomProvider({ code, children }: { code: string; children: ReactNode }) {
  const [store] = useState(() => createStore<RoomClientState>(() => initialRoomState));
  const connection = useRef<RoomConnection | null>(null);

  useEffect(() => {
    store.setState(initialRoomState, true);
    const current = connectRoom({
      code,
      dispatch: (event) => store.setState((state) => reduce(state, event), true),
    });
    connection.current = current;
    return () => {
      current.close();
      connection.current = null;
    };
  }, [code, store]);

  const value = useMemo(() => ({ store, connection }), [store]);
  return (
    <RoomContext.Provider value={value}>
      <MutedProvider key={code} code={code}>
        {children}
      </MutedProvider>
    </RoomContext.Provider>
  );
}

function useRoomContext(): RoomContextValue {
  const value = useContext(RoomContext);
  if (!value) throw new Error("useRoom* must be used inside <RoomProvider>");
  return value;
}

export function useRoomState<T>(selector: (state: RoomClientState) => T): T {
  return useStore(useRoomContext().store, selector);
}

export interface RoomActions {
  /** Sends a room message; false when not connected. */
  send(message: ClientMessage): boolean;
  /** Sends a game action for the current turn and marks it pending. */
  act(action: Action): void;
  /** Connects again with a fresh ticket (after a block, so the ticket carries it). */
  reconnect(): void;
}

export function useRoomActions(): RoomActions {
  const { store, connection } = useRoomContext();
  return useMemo(
    () => ({
      send: (message) => connection.current?.send(message) ?? false,
      act: (action) => {
        const state = store.getState();
        if (!state.game || state.actionPending) return;
        const sent =
          connection.current?.send({ t: "action", turn: state.game.turn, action }) ?? false;
        if (sent) store.setState((s) => reduce(s, { type: "actionSent" }), true);
      },
      reconnect: () => connection.current?.reconnect(),
    }),
    [store, connection],
  );
}

/**
 * A provider over a fixed state, for component tests and fixture pages:
 * messages go to `onSend` instead of a socket. Mutes are kept like in a room
 * (per `state.room.code`).
 */
export function StaticRoomProvider({
  state,
  onSend = () => true,
  onReconnect = () => {},
  children,
}: {
  state: RoomClientState;
  onSend?: (message: ClientMessage) => boolean;
  onReconnect?: () => void;
  children: ReactNode;
}) {
  const [store] = useState(() => createStore<RoomClientState>(() => state));
  const connection = useRef<RoomConnection | null>({
    send: onSend,
    reconnect: onReconnect,
    close: () => {},
  });
  useEffect(() => {
    store.setState(state, true);
  }, [store, state]);
  const value = useMemo(() => ({ store, connection }), [store]);
  const code = state.room?.code ?? null;
  return (
    <RoomContext.Provider value={value}>
      <MutedProvider key={code ?? ""} code={code}>
        {children}
      </MutedProvider>
    </RoomContext.Provider>
  );
}
