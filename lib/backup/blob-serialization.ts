import type { UploadedTimetableReference } from "@/types/domain";
import { storedBinaryBytes, storedBinarySize } from "@/lib/stored-binary";
import { BACKUP_LIMITS } from "@/lib/validation/backup-limits";
import { BackupError } from "./backup-errors";
import type { SerializedUploadedTimetableReference } from "./schema";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    result += ALPHABET[(combined >> 18) & 63];
    result += ALPHABET[(combined >> 12) & 63];
    result += index + 1 < bytes.length ? ALPHABET[(combined >> 6) & 63] : "=";
    result += index + 2 < bytes.length ? ALPHABET[combined & 63] : "=";
  }
  return result;
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, "");
  const output = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let outputIndex = 0;
  for (const character of clean) {
    const value = ALPHABET.indexOf(character);
    if (value < 0) {
      throw new BackupError(
        "SCHEMA_INVALID",
        "An embedded timetable file contains invalid encoded data.",
      );
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[outputIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return output;
}

export async function serializeUploadReferences(
  references: readonly UploadedTimetableReference[],
): Promise<SerializedUploadedTimetableReference[]> {
  let totalBytes = 0;
  const serialized: SerializedUploadedTimetableReference[] = [];
  for (const reference of references) {
    if (
      !["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(
        reference.mediaType,
      )
    ) {
      throw new BackupError(
        "SCHEMA_INVALID",
        `Uploaded source ${reference.filename} has an unsupported media type.`,
      );
    }
    if (
      reference.size !== storedBinarySize(reference.blob) ||
      reference.size > BACKUP_LIMITS.maxEmbeddedBlobBytes
    ) {
      throw new BackupError(
        "LIMIT_EXCEEDED",
        `Uploaded source ${reference.filename} exceeds the backup attachment limit or has inconsistent metadata.`,
      );
    }
    totalBytes += reference.size;
    if (totalBytes > BACKUP_LIMITS.maxTotalDecodedBlobBytes) {
      throw new BackupError(
        "LIMIT_EXCEEDED",
        "Uploaded timetable sources exceed the total backup attachment limit.",
      );
    }
    const bytes = await storedBinaryBytes(reference.blob);
    serialized.push({
      id: reference.id,
      profileId: reference.profileId,
      semesterId: reference.semesterId,
      filename: reference.filename,
      mediaType:
        reference.mediaType as SerializedUploadedTimetableReference["mediaType"],
      size: reference.size,
      blobBase64: bytesToBase64(bytes),
      rotation: reference.rotation,
      zoom: reference.zoom,
      crop: { ...reference.crop },
      createdAt: reference.createdAt,
      updatedAt: reference.updatedAt,
    });
  }
  return serialized;
}

export function deserializeUploadReferences(
  references: readonly SerializedUploadedTimetableReference[],
): UploadedTimetableReference[] {
  let totalBytes = 0;
  return references.map((reference) => {
    const bytes = base64ToBytes(reference.blobBase64);
    totalBytes += bytes.byteLength;
    if (
      bytes.byteLength !== reference.size ||
      bytes.byteLength > BACKUP_LIMITS.maxEmbeddedBlobBytes ||
      totalBytes > BACKUP_LIMITS.maxTotalDecodedBlobBytes
    ) {
      throw new BackupError(
        "LIMIT_EXCEEDED",
        "An embedded timetable source exceeds its validated size limit.",
      );
    }
    const isolated = new Uint8Array(bytes.byteLength);
    isolated.set(bytes);
    return {
      id: reference.id,
      profileId: reference.profileId,
      semesterId: reference.semesterId,
      filename: reference.filename,
      mediaType: reference.mediaType,
      size: reference.size,
      blob: isolated,
      rotation: reference.rotation,
      zoom: reference.zoom,
      crop: { ...reference.crop },
      createdAt: reference.createdAt,
      updatedAt: reference.updatedAt,
    };
  });
}
