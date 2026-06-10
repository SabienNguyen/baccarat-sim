import { render } from "@testing-library/react";
import { Dealer } from "./Dealer";

test("is decorative (hidden from the accessibility tree)", () => {
  const { container } = render(<Dealer phase="Betting" />);
  const figure = container.querySelector(".dealer-figure");
  expect(figure).not.toBeNull();
  expect(figure).toHaveAttribute("aria-hidden", "true");
});

test("works the cards only during the Dealing phase", () => {
  const { container, rerender } = render(<Dealer phase="Betting" />);
  expect(container.querySelector(".dealer-figure.is-dealing")).toBeNull();

  rerender(<Dealer phase="Dealing" />);
  expect(container.querySelector(".dealer-figure.is-dealing")).not.toBeNull();

  rerender(<Dealer phase="Settled" />);
  expect(container.querySelector(".dealer-figure.is-dealing")).toBeNull();
});
