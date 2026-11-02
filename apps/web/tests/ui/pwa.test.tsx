/**
 * PWA client components: the screen wake lock helper and the service worker
 * registration.
 */
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KeepScreenOn } from "@/components/pwa/KeepScreenOn";
import { ServiceWorker } from "@/components/pwa/ServiceWorker";

function setNavigator(key: "wakeLock" | "serviceWorker", value: unknown) {
  Object.defineProperty(window.navigator, key, { configurable: true, value });
}

function unsetNavigator(key: "wakeLock" | "serviceWorker") {
  Reflect.deleteProperty(window.navigator, key);
}

describe("KeepScreenOn", () => {
  let visibility: DocumentVisibilityState;
  let sentinels: Array<{ type: string; released: boolean; release: ReturnType<typeof vi.fn> }>;
  let request: ReturnType<typeof vi.fn>;

  function setVisibility(next: DocumentVisibilityState) {
    visibility = next;
    // The browser releases the lock by itself when the page is hidden.
    if (next === "hidden") for (const s of sentinels) s.released = true;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  const held = () => sentinels.filter((s) => !s.released);

  beforeEach(() => {
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    sentinels = [];
    request = vi.fn(async (type: string) => {
      const sentinel = {
        type,
        released: false,
        release: vi.fn(async () => {
          sentinel.released = true;
        }),
      };
      sentinels.push(sentinel);
      return sentinel;
    });
    setNavigator("wakeLock", { request });
  });

  afterEach(() => {
    unsetNavigator("wakeLock");
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("holds a screen lock while active and visible", async () => {
    const { container } = render(<KeepScreenOn active />);
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(held()).toHaveLength(1));
    expect(request).toHaveBeenCalledWith("screen");
  });

  it("does nothing while inactive", async () => {
    render(<KeepScreenOn active={false} />);
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
  });

  it("waits for the page to be visible", async () => {
    visibility = "hidden";
    render(<KeepScreenOn active />);
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
    setVisibility("visible");
    await waitFor(() => expect(held()).toHaveLength(1));
  });

  it("takes the lock again when the page comes back", async () => {
    render(<KeepScreenOn active />);
    await waitFor(() => expect(held()).toHaveLength(1));
    setVisibility("hidden");
    expect(held()).toHaveLength(0);
    setVisibility("visible");
    await waitFor(() => expect(held()).toHaveLength(1));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not stack locks on repeated visibility events", async () => {
    render(<KeepScreenOn active />);
    await waitFor(() => expect(held()).toHaveLength(1));
    setVisibility("visible");
    setVisibility("visible");
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases the lock when it turns inactive, and on unmount", async () => {
    const { rerender, unmount } = render(<KeepScreenOn active />);
    await waitFor(() => expect(held()).toHaveLength(1));
    rerender(<KeepScreenOn active={false} />);
    await waitFor(() => expect(held()).toHaveLength(0));
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);

    // Inactive: becoming visible again takes nothing.
    setVisibility("hidden");
    setVisibility("visible");
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);

    rerender(<KeepScreenOn active />);
    await waitFor(() => expect(held()).toHaveLength(1));
    unmount();
    await waitFor(() => expect(held()).toHaveLength(0));
  });

  it("releases a lock granted after it was unmounted", async () => {
    let grant: (value: unknown) => void = () => undefined;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const { unmount } = render(<KeepScreenOn active />);
    unmount();
    const late = { type: "screen", released: false, release: vi.fn(async () => undefined) };
    await act(async () => grant(late));
    expect(late.release).toHaveBeenCalled();
  });

  it("stays silent when the lock is refused", async () => {
    request.mockRejectedValue(new DOMException("Battery saver", "NotAllowedError"));
    render(<KeepScreenOn active />);
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);
    expect(held()).toHaveLength(0);
  });

  it("does nothing where the API is missing", async () => {
    unsetNavigator("wakeLock");
    expect("wakeLock" in navigator).toBe(false);
    const { unmount } = render(<KeepScreenOn active />);
    setVisibility("visible");
    await act(async () => {});
    unmount();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("ServiceWorker", () => {
  let register: ReturnType<typeof vi.fn>;
  let unregister: ReturnType<typeof vi.fn>;
  let readyState: DocumentReadyState;

  beforeEach(() => {
    register = vi.fn(async () => ({}));
    unregister = vi.fn(async () => true);
    setNavigator("serviceWorker", {
      register,
      getRegistrations: vi.fn(async () => [{ unregister }]),
    });
    readyState = "complete";
    Object.defineProperty(document, "readyState", { configurable: true, get: () => readyState });
  });

  afterEach(() => {
    unsetNavigator("serviceWorker");
    Reflect.deleteProperty(document, "readyState");
  });

  it("registers /sw.js for the whole site in production, after load", async () => {
    vi.stubEnv("NODE_ENV", "production");
    readyState = "loading";
    const { container } = render(<ServiceWorker />);
    expect(container).toBeEmptyDOMElement();
    expect(register).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new Event("load"));
    });
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
    expect(unregister).not.toHaveBeenCalled();
  });

  it("registers at once when the page has already loaded", () => {
    vi.stubEnv("NODE_ENV", "production");
    render(<ServiceWorker />);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("never registers outside production, and removes a leftover worker", async () => {
    vi.stubEnv("NODE_ENV", "development");
    render(<ServiceWorker />);
    act(() => {
      window.dispatchEvent(new Event("load"));
    });
    expect(register).not.toHaveBeenCalled();
    await waitFor(() => expect(unregister).toHaveBeenCalled());
  });

  it("does nothing without service worker support", () => {
    vi.stubEnv("NODE_ENV", "production");
    unsetNavigator("serviceWorker");
    expect(() => render(<ServiceWorker />)).not.toThrow();
    expect(register).not.toHaveBeenCalled();
  });
});
