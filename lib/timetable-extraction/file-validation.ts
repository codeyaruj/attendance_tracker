import {
  EXTRACTION_LIMITS,
  TimetableExtractionError,
  type TimetableFileKind,
} from "./types";

const MIME_TO_EXTENSIONS = new Map<string, ReadonlySet<string>>([
  ["image/png", new Set(["png"])],
  ["image/jpeg", new Set(["jpg", "jpeg"])],
  ["image/webp", new Set(["webp"])],
  ["application/pdf", new Set(["pdf"])],
]);

export interface ValidatedTimetableFile {
  file: File;
  kind: TimetableFileKind;
  mediaType: string;
}

function extensionOf(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot < 0 ? "" : filename.slice(lastDot + 1).toLowerCase();
}

function signatureMatches(bytes: Uint8Array, mediaType: string): boolean {
  if (mediaType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mediaType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    );
  }
  if (mediaType === "image/webp") {
    return (
      new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP"
    );
  }
  if (mediaType === "application/pdf") {
    return new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-";
  }
  return false;
}

export function validateBasicFile(file: File): ValidatedTimetableFile {
  if (file.size === 0) {
    throw new TimetableExtractionError(
      "EMPTY_FILE",
      "The selected file is empty.",
    );
  }
  if (file.size > EXTRACTION_LIMITS.maximumFileBytes) {
    throw new TimetableExtractionError(
      "FILE_TOO_LARGE",
      "Choose a timetable file no larger than 10 MB.",
    );
  }
  const extensions = MIME_TO_EXTENSIONS.get(file.type);
  if (!extensions) {
    throw new TimetableExtractionError(
      "UNSUPPORTED_TYPE",
      "Use a PNG, JPEG, WebP, or PDF timetable.",
    );
  }
  if (!extensions.has(extensionOf(file.name))) {
    throw new TimetableExtractionError(
      "SPOOFED_FILE",
      "The file extension does not match its declared file type.",
    );
  }
  return {
    file,
    kind: file.type === "application/pdf" ? "PDF" : "IMAGE",
    mediaType: file.type,
  };
}

export async function validateTimetableFile(
  file: File,
): Promise<ValidatedTimetableFile> {
  const validated = validateBasicFile(file);
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!signatureMatches(header, file.type)) {
    throw new TimetableExtractionError(
      "SPOOFED_FILE",
      "The file contents do not match the selected file type.",
    );
  }
  return validated;
}

export function assertExtractionBrowserSupport(): void {
  if (
    typeof window === "undefined" ||
    typeof Worker === "undefined" ||
    typeof WebAssembly === "undefined" ||
    typeof document?.createElement !== "function"
  ) {
    throw new TimetableExtractionError(
      "UNSUPPORTED_BROWSER",
      "This browser does not provide the local OCR features AttendSafe needs.",
    );
  }
}
