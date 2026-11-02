"use client";

/**
 * React bindings: one store and one connection per mounted room.
 *
 *   <RoomProvider code="BCDFG">…</RoomProvider>
 *   const room = useRoomState((s) => s.room);
 *   const { send, act } = useRoomActions();
 */
import {
  createContext,
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
import { initialRoomState, reduce, type RoomClientState } from "./state";

interface RoomContextValue {
  store: StoreApi<RoomClientState>;
  connection: RefObject<RoomConnection | null>;
}

const RoomContext = createContext<RoomContextValue | null>(null);

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
  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
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
    }),
    [store, connection],
  );
}

/**
 * A provider over a fixed state, for component tests and fixture pages:
 * messages go to `onSend` instead of a socket.
 */
export function StaticRoomProvider({
  state,
  onSend = () => true,
  children,
}: {
  state: RoomClientState;
  onSend?: (message: ClientMessage) => boolean;
  children: ReactNode;
}) {
  const [store] = useState(() => createStore<RoomClientState>(() => state));
  const connection = useRef<RoomConnection | null>({ send: onSend, close: () => {} });
  useEffect(() => {
    store.setState(state, true);
  }, [store, state]);
  const value = useMemo(() => ({ store, connection }), [store]);
  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
