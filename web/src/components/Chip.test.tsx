import { render, screen, fireEvent } from "@testing-library/react";
import { Chip, chipFace } from "./Chip";

test("chipFace shortens denominations", () => {
  expect(chipFace(2500)).toBe("$25");
  expect(chipFace(10000)).toBe("$100");
  expect(chipFace(100000)).toBe("$1k");
});

test("renders an accessible chip and selects on click", () => {
  const onSelect = vi.fn();
  render(<Chip cents={50000} selected={false} onSelect={onSelect} />);
  const chip = screen.getByRole("button", { name: "$500.00 chip" });
  expect(chip).toHaveAttribute("draggable", "true");
  fireEvent.click(chip);
  expect(onSelect).toHaveBeenCalledWith(50000);
});

test("dragging the chip writes its cents to the dataTransfer", () => {
  render(<Chip cents={2500} selected={true} onSelect={vi.fn()} />);
  const chip = screen.getByRole("button", { name: "$25.00 chip" });
  const setData = vi.fn();
  fireEvent.dragStart(chip, {
    dataTransfer: { setData, effectAllowed: "" },
  });
  expect(setData).toHaveBeenCalledWith("text/plain", "2500");
});
