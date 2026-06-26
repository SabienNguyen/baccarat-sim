import { render, screen, fireEvent } from "@testing-library/react";
import { Chip, chipFace } from "./Chip";

test("chipFace shortens denominations", () => {
  expect(chipFace(100)).toBe("$1");
  expect(chipFace(2500)).toBe("$25");
  expect(chipFace(10000)).toBe("$100");
  expect(chipFace(100000)).toBe("$1k");
});

test("clicking a chip arms its denomination", () => {
  const onSelect = vi.fn();
  render(<Chip cents={50000} selected={false} onSelect={onSelect} />);
  const chip = screen.getByRole("button", { name: "$500.00 chip" });
  expect(chip).toHaveAttribute("draggable", "true");
  fireEvent.click(chip);
  expect(onSelect).toHaveBeenCalledWith(50000);
});

test("the armed chip is pressed; an unaffordable chip is disabled", () => {
  const { rerender } = render(<Chip cents={2500} selected onSelect={vi.fn()} />);
  const chip = screen.getByRole("button", { name: "$25.00 chip" });
  expect(chip).toHaveAttribute("aria-pressed", "true");
  rerender(<Chip cents={2500} selected={false} disabled onSelect={vi.fn()} />);
  expect(screen.getByRole("button", { name: "$25.00 chip" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "$25.00 chip" })).toHaveAttribute("draggable", "false");
});

test("dragging the chip writes its cents to the dataTransfer", () => {
  render(<Chip cents={2500} selected={false} onSelect={vi.fn()} />);
  const chip = screen.getByRole("button", { name: "$25.00 chip" });
  const setData = vi.fn();
  fireEvent.dragStart(chip, { dataTransfer: { setData, effectAllowed: "" } });
  expect(setData).toHaveBeenCalledWith("text/plain", "2500");
});
