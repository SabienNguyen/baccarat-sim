import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("render blew up");
}

test("renders children when nothing throws", () => {
  render(
    <ErrorBoundary>
      <div>the felt</div>
    </ErrorBoundary>,
  );
  expect(screen.getByText("the felt")).toBeInTheDocument();
});

test("a render-time throw becomes a recoverable notice, not a blank page", () => {
  // React logs the caught error to console.error; silence it for the test.
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
  expect(screen.getByText("The table hit a snag")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  spy.mockRestore();
});
