import { describe, expect, it } from "vitest";
import {
  EXTRACTION_LIMITS,
  assertPdfPageCount,
  classifyPdfError,
  validateBasicFile,
  validateTimetableFile,
} from "@/lib/timetable-extraction";

function file(bytes: number[], name: string, type: string): File {
  const value = new File([new Uint8Array(bytes)], name, { type });
  const originalSlice = value.slice.bind(value);
  Object.defineProperty(value, "slice", {
    value(start?: number, end?: number, contentType?: string) {
      const blob = originalSlice(start, end, contentType);
      if (typeof blob.arrayBuffer !== "function") {
        Object.defineProperty(blob, "arrayBuffer", {
          value: async () =>
            new Uint8Array(bytes.slice(start ?? 0, end)).buffer,
        });
      }
      return blob;
    },
  });
  return value;
}

describe("local timetable file validation", () => {
  it.each([
    [
      "valid PNG",
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "table.png",
      "image/png",
      "IMAGE",
    ],
    [
      "valid JPEG",
      [0xff, 0xd8, 0xff, 0xe0],
      "table.jpeg",
      "image/jpeg",
      "IMAGE",
    ],
    [
      "valid WebP",
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
      "table.webp",
      "image/webp",
      "IMAGE",
    ],
    [
      "valid PDF",
      [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31],
      "table.pdf",
      "application/pdf",
      "PDF",
    ],
  ])("accepts a %s", async (_label, bytes, name, type, kind) => {
    await expect(
      validateTimetableFile(
        file(bytes as number[], name as string, type as string),
      ),
    ).resolves.toMatchObject({ kind });
  });

  it("rejects unsupported MIME types", () => {
    expect(() =>
      validateBasicFile(file([1], "table.gif", "image/gif")),
    ).toThrow("PNG, JPEG, WebP, or PDF");
  });

  it("rejects a spoofed extension", () => {
    expect(() =>
      validateBasicFile(file([0xff, 0xd8, 0xff], "table.png", "image/jpeg")),
    ).toThrow("extension does not match");
  });

  it("rejects a spoofed MIME signature", async () => {
    await expect(
      validateTimetableFile(
        file([0x25, 0x50, 0x44, 0x46, 0x2d], "table.png", "image/png"),
      ),
    ).rejects.toMatchObject({ code: "SPOOFED_FILE" });
  });

  it("rejects empty files before reading bytes", () => {
    expect(() =>
      validateBasicFile(file([], "table.pdf", "application/pdf")),
    ).toThrow("empty");
  });

  it("rejects files above 10 MB before reading bytes", () => {
    const oversized = file([1], "table.png", "image/png");
    Object.defineProperty(oversized, "size", {
      value: EXTRACTION_LIMITS.maximumFileBytes + 1,
    });
    expect(() => validateBasicFile(oversized)).toThrow("no larger than 10 MB");
  });

  it("rejects PDFs above five pages and empty/corrupt documents", () => {
    expect(() => assertPdfPageCount(6)).toThrowError(
      expect.objectContaining({ code: "PDF_PAGE_LIMIT" }),
    );
    expect(() => assertPdfPageCount(0)).toThrowError(
      expect.objectContaining({ code: "CORRUPT_PDF" }),
    );
  });

  it("classifies encrypted and unreadable PDF.js failures", () => {
    expect(classifyPdfError({ name: "PasswordException" })).toMatchObject({
      code: "ENCRYPTED_PDF",
    });
    expect(classifyPdfError(new Error("invalid xref"))).toMatchObject({
      code: "CORRUPT_PDF",
    });
  });
});
