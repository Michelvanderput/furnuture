import { describe, expect, it } from "vitest";
import { toFloat32 } from "../lib/labels";

describe("toFloat32", () => {
  it("decodes half floats from fp16 models", () => {
    // 1.0, -2.0, 0.5, 0, 65504 (max half)
    const out = toFloat32({ type: "float16", data: new Uint16Array([0x3c00, 0xc000, 0x3800, 0x0000, 0x7bff]) });
    expect(Array.from(out)).toEqual([1, -2, 0.5, 0, 65504]);
  });

  it("passes float32 data through without copying", () => {
    const data = new Float32Array([1.5, -3]);
    expect(toFloat32({ type: "float32", data })).toBe(data);
  });
});
