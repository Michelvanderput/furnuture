import { describe, expect, it } from "vitest";
import { homography, project, quadToMatrix3d, rectQuad, rotateQuad, turnQuad } from "@/lib/geometry";
import { pushPullFill } from "@/lib/inpaint";
import type { Quad } from "@/lib/types";

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe("homography", () => {
  it("maps the corners of one quad onto another", () => {
    const from = rectQuad(0, 0, 100, 50);
    const to: Quad = [[10, 20], [200, 5], [220, 300], [0, 250]];
    const h = homography(from, to);
    from.forEach((p, i) => close(project(h, p), to[i]));
  });

  it("builds a CSS matrix3d that is the identity for an unchanged rectangle", () => {
    expect(quadToMatrix3d(100, 50, rectQuad(0, 0, 100, 50))).toBe("matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)");
  });

  it("rotates around the centre and turns one side away", () => {
    const q = rectQuad(0, 0, 100, 100);
    close(rotateQuad(q, 90)[0], [100, 0]);
    const turned = turnQuad(q, "right", 0.2);
    expect(turned[0]).toEqual([0, 0]);
    expect(turned[2][1] - turned[1][1]).toBeCloseTo(80); // right edge is shorter
    expect(turned[1][0]).toBeLessThan(100); // and moved inward
  });
});

describe("pushPullFill", () => {
  it("fills a hole with the colour around it", () => {
    const w = 16, h = 16;
    const rgb = new Uint8ClampedArray(w * h * 4);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const top = Math.floor(i / w) < h / 2;
      rgb.set(top ? [200, 200, 200, 255] : [100, 60, 20, 255], i * 4);
      const x = i % w, y = Math.floor(i / w);
      if (x >= 5 && x < 11 && y >= 3 && y < 7) {
        mask[i] = 1;
        rgb.set([255, 0, 0, 255], i * 4); // the "sofa"
      }
    }
    pushPullFill(rgb, mask, w, h);
    const px = (x: number, y: number) => [...rgb.slice((y * w + x) * 4, (y * w + x) * 4 + 3)];
    // No red left, and the hole in the wall looks like wall.
    for (let i = 0; i < w * h; i++) if (mask[i]) expect(rgb[i * 4] - rgb[i * 4 + 1]).toBeLessThan(60);
    const [r, g, b] = px(8, 4);
    expect(Math.abs(r - 200)).toBeLessThan(40);
    expect(Math.abs(g - 200)).toBeLessThan(50);
    expect(Math.abs(b - 200)).toBeLessThan(60);
  });
});
