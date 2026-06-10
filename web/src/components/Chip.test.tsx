import { render, screen, fireEvent } from "@testing-library/react";
import { Chip, chipFace } from "./Chip";

test("chipFace shortens denominations", () => {
  expect(chipFace(100)).toBe("$1");
  expect(chipFace(2500)).toBe("$25");
  expect(chipFace(10000)).toBe("$100");
  expect(chipFace(100000)).toBe("$1k");
});

test("shows its rack count and picks one up on click", () => {
  const onPick = vi.fn();
  render(<Chip cents={50000} count={7} onPick={onPick} />);
  const chip = screen.getByRole("button", { name: "$500.00 chip" });
  expect(chip).toHaveTextContent("7");
  expect(chip).toHaveAttribute("draggable", "true");
  fireEvent.click(chip);
  expect(onPick).toHaveBeenCalledWith(50000);
});

test("an empty denomination is disabled and not draggable", () => {
  render(<Chip cents={2500} count={0} onPick={vi.fn()} />);
  const chip = screen.getByRole("button", { name: "$25.00 chip" });
  expect(chip).toBeDisabled();
  expect(chip).toHaveAttribute("draggable", "false");
});

test("dragging the chip writes its cents to the dataTransfer", () => {
  render(<Chip cents={2500} count={3} onPick={vi.fn()} />);
  const chip = screen.getByRole("button", { name: "$25.00 chip" });
  const setData = vi.fn();
  fireEvent.dragStart(chip, {
    dataTransfer: { setData, effectAllowed: "" },
  });
  expect(setData).toHaveBeenCalledWith("text/plain", "2500");
});
