import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SeatsStrip } from "./SeatsStrip";
import type { SeatView } from "./protocol";

const seat = (id: number, name: string): SeatView => ({
  id,
  name,
  bankroll: 1_000_000,
  staked: 0,
  bets: [],
  sitting_out: false,
  ready: false,
  decided: false,
  host: false,
});

const seats = [seat(0, "alice"), seat(1, "bob")];

test("only our own chip is a rename control", () => {
  render(<SeatsStrip seats={seats} me={1} squeezers={null} betting onRename={() => {}} />);
  expect(screen.getByRole("button", { name: /bob — change your name/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /alice/ })).not.toBeInTheDocument();
  expect(screen.getByText("alice")).toBeInTheDocument();
});

test("clicking our name opens a box; Enter commits the trimmed name", async () => {
  const onRename = vi.fn();
  render(<SeatsStrip seats={seats} me={1} squeezers={null} betting onRename={onRename} />);
  await userEvent.click(screen.getByRole("button", { name: /bob/ }));
  const box = screen.getByRole("textbox", { name: "Your name" });
  expect(box).toHaveValue("bob");
  await userEvent.clear(box);
  await userEvent.type(box, "  robert {Enter}");
  expect(onRename).toHaveBeenCalledWith("robert");
  // back to the label, which still shows the table's name until a push lands
  expect(screen.getByRole("button", { name: /bob/ })).toBeInTheDocument();
});

test("Escape puts the old name back without sending; an unchanged or blank name is not sent", async () => {
  const onRename = vi.fn();
  render(<SeatsStrip seats={seats} me={1} squeezers={null} betting onRename={onRename} />);
  await userEvent.click(screen.getByRole("button", { name: /bob/ }));
  await userEvent.type(screen.getByRole("textbox"), "zzz{Escape}");
  expect(onRename).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: /bob/ }));
  await userEvent.type(screen.getByRole("textbox"), "{Enter}"); // unchanged
  expect(onRename).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: /bob/ }));
  await userEvent.clear(screen.getByRole("textbox"));
  await userEvent.tab(); // blur with an empty box
  expect(onRename).not.toHaveBeenCalled();
});

test("without a seat id (single player) nobody gets a rename control", () => {
  render(<SeatsStrip seats={seats} squeezers={null} betting />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("the rail shows as one more chip, only when someone is standing at it", () => {
  const { rerender } = render(<SeatsStrip seats={seats} squeezers={null} betting watchers={3} />);
  const rail = screen.getByLabelText("Watching");
  expect(rail).toHaveTextContent("3");
  expect(rail).toHaveTextContent("watching");
  rerender(<SeatsStrip seats={seats} squeezers={null} betting watchers={0} />);
  expect(screen.queryByLabelText("Watching")).not.toBeInTheDocument();
  rerender(<SeatsStrip seats={seats} squeezers={null} betting />);
  expect(screen.queryByLabelText("Watching")).not.toBeInTheDocument();
});

test("a ready seat shows its mark, only in Betting", () => {
  const ready = [{ ...seat(0, "alice"), ready: true }, seat(1, "bob")];
  const { rerender } = render(<SeatsStrip seats={ready} squeezers={null} betting />);
  expect(screen.getAllByLabelText("ready")).toHaveLength(1);
  rerender(<SeatsStrip seats={ready} squeezers={null} betting={false} />);
  expect(screen.queryByLabelText("ready")).not.toBeInTheDocument();
});

test("each seat's staged bets show as compact tokens, and hide once settled", () => {
  const withBets: SeatView[] = [
    {
      ...seat(0, "alice"),
      bets: [
        { kind: { Main: "Player" as const }, amount: 2500 },
        { kind: { Side: "Tiger" as const }, amount: 500 },
      ],
    },
    { ...seat(1, "bob"), bets: [{ kind: { Main: "Tie" as const }, amount: 500 }] },
  ];
  const { rerender } = render(<SeatsStrip seats={withBets} squeezers={null} betting />);
  expect(screen.getByText("P $25.00")).toBeInTheDocument();
  expect(screen.getByText("TIGER $5.00")).toBeInTheDocument();
  expect(screen.getByText("TIE $5.00")).toBeInTheDocument();

  rerender(<SeatsStrip seats={withBets} squeezers={null} betting={false} settled />);
  expect(screen.queryByText("P $25.00")).not.toBeInTheDocument();
  expect(screen.queryByText("TIE $5.00")).not.toBeInTheDocument();
});

const openVote = { proposer: 0, yes: [0], no: [], needed: 2 };

test("shows the host marker", () => {
  const withHost = [{ ...seat(0, "alice"), host: true }, seat(1, "bob")];
  render(<SeatsStrip seats={withHost} squeezers={null} betting />);
  const crown = screen.getByTitle("Has the cut");
  expect(crown).toBeInTheDocument();
  // only alice's chip carries it
  expect(crown.closest(".seat-chip")).toHaveTextContent("alice");
});

test("renders the vote row with the tally and my yes/no buttons", () => {
  render(
    <SeatsStrip
      seats={seats}
      me={1}
      squeezers={null}
      betting
      shoe={{ number: 1, cut_card_out: false, cut_reason: null, cutter: 0, last_cut: null, vote: openVote }}
      voteNewShoe={() => {}}
    />,
  );
  expect(screen.getByText("New shoe? 1 of 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Vote yes" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Vote no" })).toBeInTheDocument();
});

test("marks each seat's vote", () => {
  render(
    <SeatsStrip
      seats={seats}
      squeezers={null}
      betting
      shoe={{
        number: 1,
        cut_card_out: false,
        cut_reason: null,
        cutter: 0,
        last_cut: null,
        vote: { proposer: 0, yes: [0], no: [1], needed: 2 },
      }}
    />,
  );
  expect(screen.getByLabelText("voted yes")).toHaveTextContent("✓");
  expect(screen.getByLabelText("voted no")).toHaveTextContent("✗");
});

test("voting yes calls voteNewShoe(true)", async () => {
  const voteNewShoe = vi.fn();
  render(
    <SeatsStrip
      seats={seats}
      me={1}
      squeezers={null}
      betting
      shoe={{ number: 1, cut_card_out: false, cut_reason: null, cutter: 0, last_cut: null, vote: openVote }}
      voteNewShoe={voteNewShoe}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Vote yes" }));
  expect(voteNewShoe).toHaveBeenCalledWith(true);
});
