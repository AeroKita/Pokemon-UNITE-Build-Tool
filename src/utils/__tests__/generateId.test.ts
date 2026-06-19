import { afterEach, describe, expect, it, vi } from "vitest";
import { generateId, isUuidV4 } from "../generateId";

describe("generateId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when available", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
      getRandomValues: (arr: Uint8Array) => {
        arr.fill(0);
        return arr;
      },
    });
    expect(generateId()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("falls back to getRandomValues when randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i;
        return arr;
      },
    });
    const id = generateId();
    expect(isUuidV4(id)).toBe(true);
    expect(id).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("falls back to getRandomValues when randomUUID throws", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => {
        throw new TypeError("crypto.randomUUID is not a function");
      },
      getRandomValues: (arr: Uint8Array) => {
        arr[0] = 0xff;
        arr[15] = 0xee;
        return arr;
      },
    });
    const id = generateId();
    expect(isUuidV4(id)).toBe(true);
  });

  it("uses timestamp fallback when crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    const id = generateId();
    expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
  });
});
