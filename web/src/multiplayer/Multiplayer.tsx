// The multiplayer flow: lobby (list/create/join) -> live table.
// Socket lifecycle lives here; the table itself is the same GameTable the
// single-player game renders, fed by a remote store.

import { useEffect, useRef, useState } from "react";
import { GameTable } from "../App";
import { TABLES, type TableTier } from "../tables";
import { formatCents } from "../format";
import type { ClientMsg, RoomInfo, ServerMsg } from "./protocol";
import { clearSeatToken, loadSeat, saveSeatToken } from "./protocol";
import { socketUrl } from "./protocol";
import { urlParam } from "../urlParams";
import { createRemoteStore, type RemoteStore } from "./remoteStore";
import "./multiplayer.css";

function loadName(): string {
  try {
    return localStorage.getItem("baccarat.name") ?? "";
  } catch {
    return "";
  }
}
function saveName(name: string): void {
  try {
    localStorage.setItem("baccarat.name", name);
  } catch {
    /* best effort */
  }
}

interface MultiplayerProps {
  onExit: () => void;
  /** Injectable socket factory for tests. */
  connect?: () => WebSocket;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type Stage =
  | { at: "connecting" }
  | { at: "lobby" }
  | { at: "table"; store: RemoteStore; room: string }
  // Never reached the table service at all — a different situation from a
  // session that dropped, and the only one where single player is the answer.
  | { at: "offline" }
  // Trying to get back on by itself. F7 holds the seat for two minutes, so a
  // reconnect inside that window returns the player to their own chair and
  // bankroll — which only helps if a reconnect actually happens on its own.
  | { at: "reconnecting"; attempt: number }
  | { at: "dead"; why: string };

/** Retry schedule: 1s, 2s, 4s, 8s, 16s, 30s, then give up and ask the player. */
const RETRY_MAX = 6;
const retryDelay = (n: number) => Math.min(1000 * 2 ** n, 30_000);

export function Multiplayer({ onExit, connect }: MultiplayerProps) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const storeRef = useRef<RemoteStore | null>(null);
  const [stage, setStage] = useState<Stage>({ at: "connecting" });
  // Bumped by "Try again" so the connect effect re-runs when the service comes
  // back, instead of making the player reload the page.
  const [attempt, setAttempt] = useState(0);
  const opened = useRef(false);
  /** Consecutive failed connects; reset the moment one succeeds. */
  const retries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 8;
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(loadName);
  // A ?room=CODE deep link auto-joins on connect (and prefills the box so a
  // failed join leaves the code ready to retry). Skipped under an injected
  // socket (tests drive the flow themselves).
  // Cap at the server's 6-char code length: a crafted ?room=<huge> link
  // shouldn't pre-fill the box with junk or ship an oversized join.
  const autoRoom = useRef<string | null>(
    connect ? null : (urlParam("room")?.trim().toUpperCase().slice(0, 6) || null),
  );
  const [code, setCode] = useState(autoRoom.current ?? "");
  const [tier, setTier] = useState<TableTier>("mid");
  const [isPrivate, setIsPrivate] = useState(false);

  const send = (msg: ClientMsg) => ws.current?.send(JSON.stringify(msg));

  useEffect(() => {
    let socket: WebSocket;
    try {
      socket = connect ? connect() : new WebSocket(socketUrl());
    } catch {
      setStage({ at: "offline" });
      return;
    }
    ws.current = socket;
    socket.onopen = () => {
      opened.current = true;
      retries.current = 0;
      setStage({ at: "lobby" });
      socket.send(JSON.stringify({ type: "list_rooms" }));
      // If a seat from this tab is still being held, take it back before doing
      // anything else — a drop used to cost the player their whole bankroll.
      // A refusal just leaves us in the lobby with the error notice.
      const held = loadSeat();
      if (held) {
        socket.send(JSON.stringify({ type: "rejoin", room: held.room, token: held.token }));
      }
      // Deep-link auto-join: on success we land at the table; on a bad code the
      // error handler leaves us in the (already-listed) lobby with the notice.
      if (autoRoom.current) {
        const n = name.trim() || "guest";
        saveName(n);
        socket.send(JSON.stringify({ type: "join_room", room: autoRoom.current, name: n }));
      }
    };
    socket.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        // A message we can't parse means a client/server wire mismatch —
        // don't fail invisibly, that's the only trace a stale build leaves.
        console.warn("unparseable server message:", e.data);
        return;
      }
      if (msg.type === "rooms") {
        setRooms(msg.rooms);
        setPage(0);
      } else if (msg.type === "joined") {
        if (msg.proto !== undefined && msg.proto !== 1) {
          // A protocol skew means the server may send view shapes this build
          // can't render — stop here with a clear message rather than build a
          // store from it and risk an unguarded field access white-screening
          // the app mid-game.
          console.warn(`server speaks protocol v${msg.proto}, this build expects v1`);
          storeRef.current = null;
          setStage({ at: "dead", why: "This page is out of date — refresh to get the latest table." });
          return;
        }
        if (msg.token) saveSeatToken(msg.room, msg.token);
        const store = createRemoteStore({
          tier: msg.tier,
          view: msg.view,
          me: msg.player,
          send: (m) => socket.send(JSON.stringify(m)),
        });
        storeRef.current = store;
        setStage({ at: "table", store, room: msg.room });
      } else if (msg.type === "left") {
        // A deliberate stand-up, not a drop: the seat is gone, so the token is
        // dead weight and must not be replayed on the next connect.
        clearSeatToken();
        storeRef.current = null;
        setStage({ at: "lobby" });
        socket.send(JSON.stringify({ type: "list_rooms" }));
      } else if (msg.type === "closed") {
        // The server is closing us on purpose (e.g. away too long). Show its
        // reason and stop the onclose handler from overwriting it.
        storeRef.current = null;
        setStage({ at: "dead", why: msg.reason });
      } else if (msg.type === "error") {
        if (storeRef.current) storeRef.current.handle(msg);
        else setNotice(msg.message);
      } else if (msg.type === "state" || msg.type === "announce") {
        storeRef.current?.handle(msg);
      }
    };
    socket.onclose = () => {
      setStage((s) => {
        // A close the *server* chose (AFK eviction, protocol skew) is a verdict,
        // not a blip — retrying would just get thrown out again.
        if (s.at === "dead") return s;

        const n = retries.current;
        if (n < RETRY_MAX) {
          retries.current = n + 1;
          retryTimer.current = setTimeout(() => setAttempt((a) => a + 1), retryDelay(n));
          return { at: "reconnecting", attempt: n + 1 };
        }
        // Out of patience. A close with no open before it means the service
        // never answered, so "connection dropped" would be a lie.
        return opened.current
          ? { at: "dead", why: "Connection to the casino dropped." }
          : { at: "offline" };
      });
    };
    return () => {
      // Detach every handler, not just onclose: an in-flight message
      // arriving between close() and the socket actually closing would
      // otherwise fire a stale closure that touches unmounted state.
      socket.onclose = null;
      socket.onmessage = null;
      socket.onopen = null;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Clear the "copied" flash timer on unmount so it can't fire against a
  // torn-down component.
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const rememberName = () => {
    const n = name.trim() || "guest";
    saveName(n);
    return n;
  };

  if (stage.at === "connecting") {
    return (
      <div className="mp-screen">
        <p className="mp-status">Finding the casino…</p>
        <button type="button" className="mp-back" onClick={onExit}>
          Back
        </button>
      </div>
    );
  }

  if (stage.at === "reconnecting") {
    return (
      <div className="mp-screen">
        <p className="mp-status">Reconnecting…</p>
        <p className="mp-substatus">
          Your seat and chips are held for two minutes, so you'll come back to the same
          table. Attempt {stage.attempt} of {RETRY_MAX}.
        </p>
        <button type="button" className="mp-back" onClick={onExit}>
          Back
        </button>
      </div>
    );
  }

  if (stage.at === "offline") {
    return (
      <div className="mp-screen">
        <p className="mp-status">Multiplayer is offline.</p>
        <p className="mp-substatus">
          The table service isn't running right now. Single player works exactly the same —
          same engine, same shoe, same roads — so you can keep playing.
        </p>
        <div className="mp-offline-actions">
          <button type="button" className="mp-cta" onClick={onExit}>
            Play single player
          </button>
          <button
            type="button"
            className="mp-back"
            onClick={() => {
              opened.current = false;
              retries.current = 0;
              setStage({ at: "connecting" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (stage.at === "dead") {
    // An away-too-long close is a normal event, not an outage — offer a way
    // straight back to the lobby rather than the "service is down" subtext.
    const wasAfk = stage.why.includes("away too long");
    return (
      <div className="mp-screen">
        <p className="mp-status">{stage.why}</p>
        <p className="mp-substatus">
          {wasAfk
            ? "Head back to the lobby to take a seat again."
            : "Live tables need the table service running. Single player works offline."}
        </p>
        <button type="button" className="mp-back" onClick={onExit}>
          Back
        </button>
      </div>
    );
  }

  if (stage.at === "table") {
    return (
      <div className="mp-table">
        <button
          type="button"
          className="mp-roomtag"
          title="Copy the invite link"
          onClick={async () => {
            // A full URL, not the bare code: one click drops a friend straight
            // into this table (Multiplayer auto-joins on ?room=).
            const link =
              typeof location !== "undefined"
                ? `${location.origin}${location.pathname}?room=${stage.room}`
                : stage.room;
            if (await copyText(link)) {
              setCopied(true);
              if (copyTimer.current) clearTimeout(copyTimer.current);
              copyTimer.current = setTimeout(() => setCopied(false), 1600);
            }
          }}
        >
          Table <strong>{stage.room}</strong>
          <span className="mp-copyhint">{copied ? "✓ copied" : "copy"}</span>
        </button>
        <GameTable
          store={stage.store}
          onLeave={() => {
            send({ type: "leave" });
          }}
        />
      </div>
    );
  }

  return (
    <div className="mp-screen mp-lobby" aria-label="Multiplayer lobby">
      <h2 className="mp-title">Live Tables</h2>

      <div className="mp-side">
        <section className="mp-panel">
          <h3>Your name</h3>
          <input
            className="mp-input"
            value={name}
            maxLength={24}
            placeholder="guest"
            aria-label="Your name"
            onChange={(e) => setName(e.target.value)}
          />
          {notice && <p className="mp-notice">{notice}</p>}
        </section>

        <section className="mp-panel mp-panel--join">
          <h3>Join with a code</h3>
          <p className="mp-help">Got a code from a friend? Punch it in.</p>
          <div className="mp-joinrow">
            <input
              className="mp-input mp-code"
              value={code}
              maxLength={6}
              placeholder="ABC123"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button
              type="button"
              className="mp-cta"
              disabled={code.trim().length < 6}
              onClick={() => send({ type: "join_room", room: code.trim(), name: rememberName() })}
            >
              Join
            </button>
          </div>
        </section>
      </div>

      <section className="mp-panel mp-panel--create">
        <h3>Open a table</h3>
        <div className="mp-tiers">
          {TABLES.map((t) => (
            <button
              key={t.tier}
              type="button"
              className={`mp-tier ${tier === t.tier ? "is-on" : ""}`}
              aria-pressed={tier === t.tier}
              onClick={() => setTier(t.tier)}
            >
              {t.label}
              <span>{formatCents(t.table_min)}–{formatCents(t.table_max)}</span>
            </button>
          ))}
        </div>
        <label className="mp-check">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          Private (invite code only)
        </label>
        <button
          type="button"
          className="mp-cta"
          onClick={() => send({ type: "create_room", name: rememberName(), tier, private: isPrivate })}
        >
          Create table
        </button>
      </section>

      <section className="mp-panel mp-panel--rooms">
        <h3>Public tables{rooms.length > 0 ? ` (${rooms.length})` : ""}</h3>
        {rooms.length === 0 ? (
          <p className="mp-empty">No tables open — start one.</p>
        ) : (
          <ul className="mp-rooms">
            {rooms.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((r) => (
              <li key={r.id}>
                <span className="mp-roomname">{r.id}</span>
                <span className="mp-roominfo">
                  {r.tier} · {r.seats}/{r.max_seats} seats
                </span>
                <button
                  type="button"
                  className="mp-cta"
                  disabled={r.seats >= r.max_seats}
                  onClick={() => send({ type: "join_room", room: r.id, name: rememberName() })}
                >
                  Sit
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mp-rooms-foot">
          {rooms.length > PAGE_SIZE && (
            <div className="mp-pages">
              <button
                type="button"
                className="mp-refresh"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                ‹ Prev
              </button>
              <span className="mp-pagecount">
                {page + 1} / {Math.ceil(rooms.length / PAGE_SIZE)}
              </span>
              <button
                type="button"
                className="mp-refresh"
                disabled={(page + 1) * PAGE_SIZE >= rooms.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Next ›
              </button>
            </div>
          )}
          <button type="button" className="mp-refresh" onClick={() => send({ type: "list_rooms" })}>
            Refresh
          </button>
        </div>
      </section>

      <button type="button" className="mp-back" onClick={onExit}>
        Back
      </button>
    </div>
  );
}
