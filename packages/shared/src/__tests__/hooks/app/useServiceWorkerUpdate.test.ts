/**
 * useServiceWorkerUpdate Hook Tests
 *
 * Tests the service worker update management hook that detects
 * waiting workers and provides user-controlled update application.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger and posthog
vi.mock("../../../modules/app/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../../modules/app/posthog", () => ({
  track: vi.fn(),
}));

import { useServiceWorkerUpdate } from "../../../hooks/app/useServiceWorkerUpdate";
import { logger } from "../../../modules/app/logger";
import { track } from "../../../modules/app/posthog";

describe("hooks/app/useServiceWorkerUpdate", () => {
  const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    if (originalServiceWorker) {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
    } else {
      delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    }
  });

  describe("when service worker is not available", () => {
    it("returns default state when SW not supported", () => {
      const { result } = renderHook(() => useServiceWorkerUpdate());

      expect(result.current.updateAvailable).toBe(false);
      expect(result.current.isUpdating).toBe(false);
      expect(result.current.updateStalled).toBe(false);
      expect(result.current.waitingWorker).toBeNull();
      expect(typeof result.current.applyUpdate).toBe("function");
      expect(typeof result.current.dismissUpdate).toBe("function");
    });
  });

  describe("dismissUpdate", () => {
    it("hides the update notification", () => {
      const { result } = renderHook(() => useServiceWorkerUpdate());

      act(() => {
        result.current.dismissUpdate();
      });

      expect(result.current.updateAvailable).toBe(false);
      expect(result.current.updateStalled).toBe(false);
    });
  });

  describe("applyUpdate with no waiting worker", () => {
    it("does nothing when no waiting worker", () => {
      const { result } = renderHook(() => useServiceWorkerUpdate());

      act(() => {
        result.current.applyUpdate();
      });

      expect(result.current.isUpdating).toBe(false);
      expect(result.current.updateStalled).toBe(false);
    });
  });

  describe("applyUpdate timeout", () => {
    it("falls back to updateStalled when controllerchange never fires", async () => {
      vi.stubEnv("VITE_ENABLE_SW_DEV", "true");

      const waitingWorker = {
        postMessage: vi.fn(),
      } as unknown as ServiceWorker;

      const addEventListener = vi.fn();
      const removeEventListener = vi.fn();

      const registration = {
        waiting: waitingWorker,
        update: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as ServiceWorkerRegistration;

      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          controller: {},
          addEventListener,
          removeEventListener,
          getRegistration: vi.fn().mockResolvedValue(registration),
        },
      });

      const { result } = renderHook(() => useServiceWorkerUpdate());

      await waitFor(() => {
        expect(result.current.updateAvailable).toBe(true);
      });

      vi.useFakeTimers();

      act(() => {
        result.current.applyUpdate();
      });

      expect(result.current.isUpdating).toBe(true);
      expect(result.current.updateStalled).toBe(false);
      expect(waitingWorker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
      expect(addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function), {
        once: true,
      });

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(result.current.isUpdating).toBe(false);
      expect(result.current.updateStalled).toBe(true);
      expect(track).toHaveBeenCalledWith("sw_update_apply_timeout", {});
      expect(logger.warn).toHaveBeenCalledWith(
        "Service worker update apply timed out",
        expect.objectContaining({ timeoutMs: 60_000 })
      );
      expect(removeEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function));

      act(() => {
        result.current.dismissUpdate();
      });

      expect(result.current.updateStalled).toBe(false);
      expect(result.current.updateAvailable).toBe(false);
    });
  });

  describe("return type stability", () => {
    it("returns consistent shape across renders", () => {
      const { result, rerender } = renderHook(() => useServiceWorkerUpdate());

      const keys1 = Object.keys(result.current).sort();

      rerender();

      const keys2 = Object.keys(result.current).sort();

      expect(keys1).toEqual(keys2);
      expect(keys1).toEqual([
        "applyUpdate",
        "checkForUpdate",
        "dismissUpdate",
        "isUpdating",
        "updateAvailable",
        "updateStalled",
        "waitingWorker",
      ]);
    });
  });
});
