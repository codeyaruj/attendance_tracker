import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { analyzeTableImage } from "@/lib/timetable-extraction";

const fixture = resolve(
  process.cwd(),
  "tests/fixtures/timetables/jss-ec3-odd-semester-2026-27.jpeg",
);

describe("reference timetable fixture", () => {
  it.skipIf(!existsSync(fixture))(
    "detects timetable and legend structure without fixed coordinates",
    async () => {
      const decoded = await sharp(fixture)
        .rotate()
        .ensureAlpha()
        .resize({ width: 1_600, height: 1_600, fit: "inside" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const result = analyzeTableImage({
        data: new Uint8ClampedArray(decoded.data),
        width: decoded.info.width,
        height: decoded.info.height,
      });

      expect(result.primaryGrid).toBeDefined();
      expect(result.diagnostics.regions[0]?.kind).toBe("PRIMARY_TIMETABLE");
      expect(result.primaryGrid?.rowBoundaries.length).toBeGreaterThanOrEqual(
        7,
      );
      expect(
        result.primaryGrid?.columnBoundaries.length,
      ).toBeGreaterThanOrEqual(6);
      expect(
        result.primaryGrid?.cells.some(
          (cell) => cell.columnSpan > 1 || cell.rowSpan > 1,
        ),
      ).toBe(true);
    },
  );
});
