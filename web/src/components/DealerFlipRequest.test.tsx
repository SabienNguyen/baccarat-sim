import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DealerFlipRequest } from "./DealerFlipRequest";

test("renders nothing when there is nothing to ask for", () => {
  const { container } = render(<DealerFlipRequest offer={null} onRequest={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

test("with both house cards down: Flip one and Flip both", async () => {
  const onRequest = vi.fn();
  render(<DealerFlipRequest offer={{ side: "Banker", remaining: 2 }} onRequest={onRequest} />);
  expect(screen.getByRole("group", { name: "Ask the dealer" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Flip one" }));
  expect(onRequest).toHaveBeenCalledWith("One");
  await userEvent.click(screen.getByRole("button", { name: "Flip both" }));
  expect(onRequest).toHaveBeenCalledWith("Both");
});

test("with one card left: only Flip the other", async () => {
  const onRequest = vi.fn();
  render(<DealerFlipRequest offer={{ side: "Banker", remaining: 1 }} onRequest={onRequest} />);
  expect(screen.queryByRole("button", { name: "Flip both" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Flip one" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Flip the other" }));
  expect(onRequest).toHaveBeenCalledWith("One");
});
