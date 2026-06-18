import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "./useTheme";
import { useUIStore } from "@/store/ui";

// happy-dom doesn't implement matchMedia — provide a stub
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    useUIStore.setState({ theme: "system" });
  });

  it("defaults to system when nothing is in localStorage", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
  });

  it("adds dark class when theme is set to dark", () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme("dark");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class when theme is set to light", () => {
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme("light");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("persists theme to localStorage when not system", () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme("dark");
    });
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("removes theme from localStorage when set to system", () => {
    localStorage.setItem("theme", "dark");
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme("system");
    });
    expect(localStorage.getItem("theme")).toBeNull();
  });
});
