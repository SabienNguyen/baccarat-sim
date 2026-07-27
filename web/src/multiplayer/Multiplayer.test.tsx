import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Multiplayer } from "./Multiplayer";

/** A hand-cranked WebSocket double. */
class FakeSocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  open() {
    act(() => this.onopen?.());
  }
  push(msg: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(msg) }));
  }
}

function mount() {
  const socket = new FakeSocket();
  const onExit = vi.fn();
  render(<Multiplayer onExit={onExit} connect={() => socket as unknown as WebSocket} />);
  return { socket, onExit };
}

test("connects, lists rooms, and shows the lobby", () => {
  const { socket } = mount();
  expect(screen.getByText(/Finding the casino/)).toBeInTheDocument();
  socket.open();
  expect(JSON.parse(socket.sent[0])).toEqual({ type: "list_rooms" });
  expect(screen.getByText("Live Tables")).toBeInTheDocument();

  socket.push({ type: "rooms", rooms: [{ id: "AB12CD", tier: "mid", seats: 2, max_seats: 7 }] });
  expect(screen.getByText("AB12CD")).toBeInTheDocument();
  expect(screen.getByText(/2\/7 seats/)).toBeInTheDocument();
});

test("creating a table sends the choice and joining mounts the live table", async () => {
  const { socket } = mount();
  socket.open();
  await userEvent.type(screen.getByPlaceholderText("guest"), "sabien");
  await userEvent.click(screen.getByRole("button", { name: /High Roller/ }));
  await userEvent.click(screen.getByRole("button", { name: "Create table" }));
  const created = JSON.parse(socket.sent.at(-1)!);
  expect(created).toEqual({ type: "create_room", name: "sabien", tier: "high", private: false });

  socket.push({
    type: "joined",
    room: "ZZTOP2",
    player: 0,
    tier: "high",
    view: {
      phase: "Betting",
      player: { cards: [], total: null },
      banker: { cards: [], total: null },
      bets: [],
      bankroll: 25_000_000,
      table_min: 50_000,
      table_max: 10_000_000,
      outcome: null,
      payouts: null,
      events: [],
      scoreboard: {
        bead_plate: { cells: [] },
        big_road: { columns: [] },
        big_eye_boy: { columns: [] },
        small_road: { columns: [] },
        cockroach_pig: { columns: [] },
      },
      explain: [],
      seats: [
        { id: 0, name: "sabien", bankroll: 25_000_000, staked: 0, sitting_out: false, decided: false },
      ],
      player_squeezer: null,
      banker_squeezer: null,
    },
  });
  // the real table is on screen: room tag, felt, and the seat strip
  expect(screen.getByText("ZZTOP2")).toBeInTheDocument();
  expect(screen.getByLabelText("Bet rail")).toBeInTheDocument();
  expect(screen.getByLabelText("Seats")).toBeInTheDocument();
  expect(screen.getByText("sabien")).toBeInTheDocument();
});

test("an away-too-long close shows the server's reason, not a generic outage", () => {
  const { socket } = mount();
  socket.open();
  socket.push({ type: "closed", reason: "You were away too long — the table gave up your seat." });
  expect(
    screen.getByText("You were away too long — the table gave up your seat."),
  ).toBeInTheDocument();
  // and it reads as a normal event, not "the service is down"
  expect(screen.getByText(/take a seat again/)).toBeInTheDocument();
  expect(screen.queryByText(/table service running/)).toBeNull();
});

test("a join error before seating shows in the lobby", () => {
  const { socket } = mount();
  socket.open();
  socket.push({ type: "error", message: "No table by that code." });
  expect(screen.getByText("No table by that code.")).toBeInTheDocument();
});

test("the room code copies to the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  const { socket } = mount();
  socket.open();
  socket.push({
    type: "joined",
    room: "COPYME",
    player: 0,
    tier: "low",
    view: {
      phase: "Betting",
      player: { cards: [], total: null },
      banker: { cards: [], total: null },
      bets: [],
      bankroll: 50_000,
      table_min: 100,
      table_max: 50_000,
      outcome: null,
      payouts: null,
      events: [],
      scoreboard: {
        bead_plate: { cells: [] },
        big_road: { columns: [] },
        big_eye_boy: { columns: [] },
        small_road: { columns: [] },
        cockroach_pig: { columns: [] },
      },
      explain: [],
      seats: [{ id: 0, name: "me", bankroll: 50_000, staked: 0, sitting_out: false, decided: false }],
      player_squeezer: null,
      banker_squeezer: null,
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /COPYME/ }));
  // the invite is now a full deep link (?room=CODE), not the bare code
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("?room=COPYME"));
  expect(await screen.findByText("✓ copied")).toBeInTheDocument();
});

test("the public list paginates past eight tables", async () => {
  const { socket } = mount();
  socket.open();
  const rooms = Array.from({ length: 20 }, (_, i) => ({
    id: `ROOM${String(i).padStart(2, "0")}`,
    tier: "mid",
    seats: 0,
    max_seats: 7,
  }));
  socket.push({ type: "rooms", rooms });
  expect(screen.getByText(/Public tables \(20\)/)).toBeInTheDocument();
  expect(screen.getByText("ROOM00")).toBeInTheDocument();
  expect(screen.queryByText("ROOM08")).toBeNull(); // page 1 holds eight
  expect(screen.getByText("1 / 3")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(screen.getByText("ROOM08")).toBeInTheDocument();
  expect(screen.queryByText("ROOM00")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Next ›" }));
  expect(screen.getByText("ROOM16")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next ›" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "‹ Prev" }));
  expect(screen.getByText("2 / 3")).toBeInTheDocument();
  expect(screen.getByText("ROOM08")).toBeInTheDocument();
});

/** Drive the retry budget to exhaustion so a terminal screen appears. */
function exhaustRetries(sockets: FakeSocket[], openFirst = false) {
  if (openFirst) sockets[0].open();
  // RETRY_MAX retries are allowed, so the terminal screen needs one close beyond
  // the budget — 6 closes still leaves it hopefully reconnecting.
  for (let i = 0; i < 7; i++) {
    act(() => sockets[sockets.length - 1].onclose?.());
    act(() => vi.advanceTimersByTime(60_000));
  }
}

function mountCollecting() {
  const sockets: FakeSocket[] = [];
  const onExit = vi.fn();
  render(
    <Multiplayer
      onExit={onExit}
      connect={() => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as WebSocket;
      }}
    />,
  );
  return { sockets, onExit };
}

test("a server that never answers reads as offline once retries are spent", async () => {
  vi.useFakeTimers();
  const { sockets, onExit } = mountCollecting();
  exhaustRetries(sockets);

  expect(screen.getByText(/Multiplayer is offline/)).toBeInTheDocument();
  expect(screen.getByText(/Single player works/)).toBeInTheDocument();
  // "dropped" would claim a session that never existed
  expect(screen.queryByText(/dropped/i)).toBeNull();
  vi.useRealTimers();

  await userEvent.click(screen.getByRole("button", { name: "Play single player" }));
  expect(onExit).toHaveBeenCalled();
});

test("a close after a live session still reads as a dropped connection", () => {
  vi.useFakeTimers();
  const { sockets } = mountCollecting();
  exhaustRetries(sockets, true);
  expect(screen.getByText(/dropped/i)).toBeInTheDocument();
  expect(screen.queryByText(/Multiplayer is offline/)).toBeNull();
  vi.useRealTimers();
});

test("Try again reconnects instead of making the player reload", async () => {
  vi.useFakeTimers();
  const { sockets } = mountCollecting();
  exhaustRetries(sockets);
  expect(screen.getByText(/Multiplayer is offline/)).toBeInTheDocument();
  const before = sockets.length;
  vi.useRealTimers();

  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(sockets.length).toBe(before + 1); // a fresh socket, not a page reload
  sockets[sockets.length - 1].open();
  expect(screen.getByText("Live Tables")).toBeInTheDocument();
});

test("a held seat is reclaimed on reconnect instead of buying in again", () => {
  sessionStorage.setItem(
    "baccarat.seat",
    JSON.stringify({ room: "AB12CD", token: "tok-123" }),
  );
  const { socket } = mount();
  socket.open();
  const sent = socket.sent.map((s) => JSON.parse(s));
  expect(sent).toContainEqual({ type: "rejoin", room: "AB12CD", token: "tok-123" });
  sessionStorage.clear();
});

test("no stored seat means no rejoin attempt", () => {
  sessionStorage.clear();
  const { socket } = mount();
  socket.open();
  const kinds = socket.sent.map((s) => JSON.parse(s).type);
  expect(kinds).not.toContain("rejoin");
});

test("standing up on purpose burns the token, so it isn't replayed", () => {
  sessionStorage.setItem(
    "baccarat.seat",
    JSON.stringify({ room: "AB12CD", token: "tok-123" }),
  );
  const { socket } = mount();
  socket.open();
  socket.push({ type: "left" });
  expect(sessionStorage.getItem("baccarat.seat")).toBeNull();
});

describe("auto-reconnect (F10)", () => {
  test("a dropped socket retries by itself instead of dead-ending", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    render(
      <Multiplayer
        onExit={vi.fn()}
        connect={() => {
          const s = new FakeSocket();
          sockets.push(s);
          return s as unknown as WebSocket;
        }}
      />,
    );
    sockets[0].open();
    act(() => sockets[0].onclose?.());

    // it announces the retry rather than declaring the connection dead
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
    expect(screen.queryByText(/dropped/i)).toBeNull();

    // ...and actually opens a new socket once the backoff elapses
    expect(sockets).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(sockets).toHaveLength(2);
    vi.useRealTimers();
  });

  test("the delay backs off rather than hammering the server", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    render(
      <Multiplayer
        onExit={vi.fn()}
        connect={() => {
          const s = new FakeSocket();
          sockets.push(s);
          return s as unknown as WebSocket;
        }}
      />,
    );
    act(() => sockets[0].onclose?.());
    act(() => vi.advanceTimersByTime(1000)); // 1st retry after 1s
    expect(sockets).toHaveLength(2);

    act(() => sockets[1].onclose?.());
    act(() => vi.advanceTimersByTime(1000)); // 2nd waits 2s — not yet
    expect(sockets).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1000));
    expect(sockets).toHaveLength(3);
    vi.useRealTimers();
  });

  test("a close the server chose is a verdict, not a blip — no retry", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    render(
      <Multiplayer
        onExit={vi.fn()}
        connect={() => {
          const s = new FakeSocket();
          sockets.push(s);
          return s as unknown as WebSocket;
        }}
      />,
    );
    sockets[0].open();
    sockets[0].push({ type: "closed", reason: "You were away too long." });
    act(() => sockets[0].onclose?.());

    expect(screen.getByText(/away too long/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(sockets).toHaveLength(1);
    vi.useRealTimers();
  });
});
