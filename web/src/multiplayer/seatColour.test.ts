import { seatColour } from "./seatColour";

test("each seat id in the palette gets its own colour variable", () => {
  const colours = new Set(Array.from({ length: 7 }, (_, id) => seatColour(id)));
  expect(colours.size).toBe(7);
});

test("the palette wraps at 7 seats", () => {
  expect(seatColour(7)).toBe(seatColour(0));
  expect(seatColour(8)).toBe(seatColour(1));
});

test("is stable for the same id", () => {
  expect(seatColour(3)).toBe(seatColour(3));
});
