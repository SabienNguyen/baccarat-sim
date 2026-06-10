import { render, screen } from "@testing-library/react";
import { WinPopup } from "./WinPopup";

test("renders nothing when amount is null", () => {
  const { container } = render(<WinPopup amount={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("renders nothing when amount is zero (a push)", () => {
  const { container } = render(<WinPopup amount={0} />);
  expect(container).toBeEmptyDOMElement();
});

test("renders a positive payout with a + sign and win styling", () => {
  render(<WinPopup amount={9500} />);
  const el = screen.getByText("+$95.00");
  expect(el).toBeInTheDocument();
  expect(el).toHaveAttribute("data-sign", "win");
});

test("renders a negative payout with loss styling", () => {
  render(<WinPopup amount={-500} />);
  const el = screen.getByText("-$5.00");
  expect(el).toHaveAttribute("data-sign", "loss");
});
