import "@testing-library/jest-dom/vitest";

// jsdom does not implement PointerEvent; polyfill it so that
// fireEvent.pointerDown/Move/Up correctly populate clientX/clientY.
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit & { clientY?: number; clientX?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  Object.defineProperty(window, "PointerEvent", { value: PointerEvent });
  Object.defineProperty(window.HTMLElement.prototype, "setPointerCapture", {
    value: () => {},
  });
  Object.defineProperty(window.HTMLElement.prototype, "releasePointerCapture", {
    value: () => {},
  });
}
