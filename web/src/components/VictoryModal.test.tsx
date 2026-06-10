import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VictoryModal } from "./VictoryModal";

test("celebrates the run and offers both exits", async () => {
  const onKeepPlaying = vi.fn();
  const onLobby = vi.fn();
  render(
    <VictoryModal
      bankroll={520_000}
      goal={500_000}
      onKeepPlaying={onKeepPlaying}
      onLobby={onLobby}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "Table beaten" });
  expect(dialog).toHaveTextContent("TABLE BEATEN!");
  expect(dialog).toHaveTextContent("$5,200.00");
  expect(dialog).toHaveTextContent(/past \$5,000\.00/);
  await userEvent.click(screen.getByRole("button", { name: "Keep playing" }));
  expect(onKeepPlaying).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Back to lobby" }));
  expect(onLobby).toHaveBeenCalledOnce();
});
