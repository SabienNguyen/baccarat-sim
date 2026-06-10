// The multiplayer flow: lobby (list/create/join) -> live table.
// Socket lifecycle lives here; the table itself is the same GameTable the
// single-player game renders, fed by a remote store.

import { useEffect, useRef, useState } from "react";
import { GameTable } from "../App";
import { TABLES, type TableTier } from "../tables";
import { formatCents } from "../format";
import type { ClientMsg, RoomInfo, ServerMsg } from "./protocol";
import { socketUrl } from "./protocol";
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
  | { at: "dead"; why: string };

export function Multiplayer({ onExit, connect }: MultiplayerProps) {
  const [copied, setCopied] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const storeRef = useRef<RemoteStore | null>(null);
  const [stage, setStage] = useState<Stage>({ at: "connecting" });
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 8;
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState("");
  const [tier, setTier] = useState<TableTier>("mid");
  const [isPrivate, setIsPrivate] = useState(false);

  const send = (msg: ClientMsg) => ws.current?.send(JSON.stringify(msg));

  useEffect(() => {
    let socket: WebSocket;
    try {
      socket = connect ? connect() : new WebSocket(socketUrl());
    } catch {
      setStage({ at: "dead", why: "The table service isn't reachable." });
      return;
    }
    ws.current = socket;
    socket.onopen = () => {
      setStage({ at: "lobby" });
      socket.send(JSON.stringify({ type: "list_rooms" }));
    };
    socket.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.type === "rooms") {
        setRooms(msg.rooms);
        setPage(0);
      } else if (msg.type === "joined") {
        const store = createRemoteStore({
          tier: msg.tier,
          view: msg.view,
          send: (m) => socket.send(JSON.stringify(m)),
        });
        storeRef.current = store;
        setStage({ at: "table", store, room: msg.room });
      } else if (msg.type === "left") {
        storeRef.current = null;
        setStage({ at: "lobby" });
        socket.send(JSON.stringify({ type: "list_rooms" }));
      } else if (msg.type === "error") {
        if (storeRef.current) storeRef.current.handle(msg);
        else setNotice(msg.message);
      } else if (msg.type === "state") {
        storeRef.current?.handle(msg);
      }
    };
    socket.onclose = () => {
      setStage((s) =>
        s.at === "dead" ? s : { at: "dead", why: "Connection to the casino dropped." },
      );
    };
    return () => {
      socket.onclose = null;
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (stage.at === "dead") {
    return (
      <div className="mp-screen">
        <p className="mp-status">{stage.why}</p>
        <p className="mp-substatus">
          Live tables need the table service running. Single player works offline.
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
          title="Copy the invite code"
          onClick={async () => {
            if (await copyText(stage.room)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
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
