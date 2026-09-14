import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Multiplayer, PING_MS } from "./Multiplayer";

/** jsdom on newer Node exposes a bare `localStorage` that is undefined (the
 *  same quirk analytics.test.ts works around); a Map-backed stand-in keeps the
 *  remembered-name checks portable. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

beforeAll(() => {
  if (typeof localStorage === "undefined") vi.stubGlobal("localStorage", fakeStorage());
});

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
        { id: 0, name: "sabien", bankroll: 25_000_000, staked: 0, bets: [], sitting_out: false, ready: false, decided: false },
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

test("renaming at the table goes over the wire and sticks for next time", async () => {
  const { socket } = mount();
  socket.open();
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
        { id: 0, name: "guest", bankroll: 25_000_000, staked: 0, bets: [], sitting_out: false, ready: false, decided: false },
      ],
      player_squeezer: null,
      banker_squeezer: null,
    },
  });
  await userEvent.click(screen.getByRole("button", { name: /guest — change your name/ }));
  const box = screen.getByRole("textbox", { name: "Your name" });
  await userEvent.clear(box);
  await userEvent.type(box, "sabien{Enter}");
  expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: "rename", name: "sabien" });
  expect(localStorage.getItem("baccarat.name")).toBe("sabien");
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
      seats: [{ id: 0, name: "me", bankroll: 50_000, staked: 0, bets: [], sitting_out: false, ready: false, decided: false }],
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

describe("join-path analytics", () => {
  type Win = { goatcounter?: { count: ReturnType<typeof vi.fn> } };
  const win = window as unknown as Win;
  let count: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    count = vi.fn();
    win.goatcounter = { count };
  });
  afterEach(() => {
    delete win.goatcounter;
  });

  function emptyView(name: string) {
    return {
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
      seats: [{ id: 0, name, bankroll: 25_000_000, staked: 0, bets: [], sitting_out: false, ready: false, decided: false }],
      player_squeezer: null,
      banker_squeezer: null,
    };
  }

  test("a lobby join reports join-lobby once the server seats us", async () => {
    const { socket } = mount();
    socket.open();
    socket.push({ type: "rooms", rooms: [{ id: "AB12CD", tier: "mid", seats: 2, max_seats: 7 }] });
    // "Sit" on a listed room and "Join" with a typed code are both lobby joins
    await userEvent.click(screen.getByRole("button", { name: "Sit" }));
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: "join_room", room: "AB12CD" });
    // nothing is counted until the join actually lands
    expect(count).not.toHaveBeenCalled();
    socket.push({ type: "joined", room: "AB12CD", player: 1, tier: "mid", view: emptyView("me") });
    expect(count).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith({ path: "event/join-lobby", event: true });
  });

  test("creating a table is not a join: no join-path event", async () => {
    const { socket } = mount();
    socket.open();
    await userEvent.click(screen.getByRole("button", { name: "Create table" }));
    socket.push({ type: "joined", room: "NEWTBL", player: 0, tier: "mid", view: emptyView("guest") });
    expect(count).not.toHaveBeenCalled();
  });
});

describe("the rail (spectator mode)", () => {
  const scoreboard = {
    bead_plate: { cells: [] },
    big_road: { columns: [] },
    big_eye_boy: { columns: [] },
    small_road: { columns: [] },
    cockroach_pig: { columns: [] },
  };
  /** The public view: the felt and the seats, no money of our own. */
  const railView = (seats = 1) => ({
    phase: "Betting",
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 0,
    table_min: 2500,
    table_max: 500_000,
    outcome: null,
    payouts: null,
    events: [],
    scoreboard,
    explain: [],
    seats: Array.from({ length: seats }, (_, i) => ({
      id: i,
      name: `p${i}`,
      bankroll: 1_000_000,
      staked: 2500,
      bets: [],
      sitting_out: false,
      ready: true,
      decided: true,
    })),
    player_squeezer: null,
    banker_squeezer: null,
  });
  const watching = (over: Record<string, unknown> = {}) => ({
    type: "watching",
    room: "AB12CD",
    tier: "mid",
    view: railView(),
    proto: 1,
    watchers: 3,
    ...over,
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  test("a full table can be watched from the lobby, and a seat taken from the rail", async () => {
    localStorage.removeItem("baccarat.name"); // a name saved by an earlier test would ride along
    const { socket } = mount();
    socket.open();
    socket.push({
      type: "rooms",
      rooms: [{ id: "AB12CD", tier: "mid", seats: 7, max_seats: 7, watchers: 2 }],
    });
    expect(screen.getByRole("button", { name: "Sit" })).toBeDisabled();
    expect(screen.getByText(/2 watching/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Watch AB12CD" }));
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: "watch", room: "AB12CD" });

    socket.push(watching());
    // the table, minus everything that needs chips
    expect(screen.getByLabelText("Seats")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bet rail")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deal" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explain" })).toBeInTheDocument();
    expect(screen.getByText("Watching")).toBeInTheDocument(); // the HUD's box
    expect(screen.getByLabelText("Watching")).toHaveTextContent("3"); // the strip's chip
    expect(sessionStorage.getItem("baccarat.watch")).toBe("AB12CD");

    // the offer: the same join as from the lobby, for this table
    await userEvent.click(screen.getByRole("button", { name: "Take a seat" }));
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: "join_room",
      room: "AB12CD",
      name: "guest",
    });
    socket.push({
      type: "joined",
      room: "AB12CD",
      player: 1,
      tier: "mid",
      view: { ...railView(2), bankroll: 1_000_000 },
    });
    expect(screen.getByLabelText("Bet rail")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take a seat" })).not.toBeInTheDocument();
    expect(sessionStorage.getItem("baccarat.watch")).toBeNull();
  });

  test("with every chair taken the offer is there but greyed", () => {
    const { socket } = mount();
    socket.open();
    socket.push(watching({ view: railView(7) }));
    expect(screen.getByRole("button", { name: "Table full" })).toBeDisabled();
  });

  test("watch by code", async () => {
    const { socket } = mount();
    socket.open();
    await userEvent.type(screen.getByPlaceholderText("ABC123"), "zztop2");
    await userEvent.click(screen.getByRole("button", { name: "Watch" }));
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: "watch", room: "ZZTOP2" });
  });

  test("the table closing under the rail lands in the lobby with the reason", () => {
    const { socket } = mount();
    socket.open();
    socket.push(watching());
    socket.push({ type: "left", reason: "The table closed — everyone left." });
    expect(screen.getByText("Live Tables")).toBeInTheDocument();
    expect(screen.getByText("The table closed — everyone left.")).toBeInTheDocument();
    expect(sessionStorage.getItem("baccarat.watch")).toBeNull();
  });

  test("the rail keeps a heartbeat so silence isn't read as away", () => {
    vi.useFakeTimers();
    const { socket } = mount();
    socket.open();
    socket.push(watching());
    const before = socket.sent.length;
    act(() => {
      vi.advanceTimersByTime(PING_MS * 2 + 10);
    });
    const pings = socket.sent.slice(before).map((s) => JSON.parse(s));
    expect(pings).toEqual([{ type: "ping" }, { type: "ping" }]);
  });

  test("a rail from this tab is taken up again on reconnect — unless a held seat comes first", () => {
    sessionStorage.setItem("baccarat.watch", "AB12CD");
    const { socket } = mount();
    socket.open();
    expect(socket.sent.map((s) => JSON.parse(s))).toContainEqual({ type: "watch", room: "AB12CD" });

    sessionStorage.setItem("baccarat.seat", JSON.stringify({ room: "ZZTOP2", token: "tok" }));
    const { socket: again } = mount();
    again.open();
    const kinds = again.sent.map((s) => JSON.parse(s).type);
    expect(kinds).toContain("rejoin");
    expect(kinds).not.toContain("watch");
  });

  test("the watch link copies a ?watch= deep link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { socket } = mount();
    socket.open();
    socket.push(watching({ room: "COPYME" }));
    await userEvent.click(screen.getByRole("button", { name: /Watch link/ }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("?watch=COPYME"));
    expect(await screen.findByText("✓ copied")).toBeInTheDocument();
  });
});
