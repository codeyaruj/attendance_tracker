import type { AppSettings, UploadedTimetableReference } from "@/types/domain";

import { normalizeDatabaseError, type AttendSafeDatabase } from "@/db/database";
import { defaultAppSettings, TABLE_NAMES } from "@/db/schema";

import {
  BACKUP_SCHEMA_VERSION,
  attendSafeBackupSchema,
  parseAndMigrateBackup,
  type AttendSafeBackupFile,
  type SerializedUploadedTimetableReference,
} from "./schema";

export * from "./schema";
export * from "./subject-csv";

export interface ExportBackupOptions {
  profileId?: string;
  includeRecentActions?: boolean;
  pretty?: boolean;
}

export interface ImportBackupOptions {
  mode?: "MERGE" | "REPLACE";
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    result += alphabet[(combined >> 18) & 63];
    result += alphabet[(combined >> 12) & 63];
    result += index + 1 < bytes.length ? alphabet[(combined >> 6) & 63] : "=";
    result += index + 2 < bytes.length ? alphabet[combined & 63] : "=";
  }
  return result;
}

function base64ToBytes(base64: string): Uint8Array {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/=+$/, "");
  const output = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let outputIndex = 0;
  for (const character of clean) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("Backup contains invalid base64 data.");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[outputIndex] = (buffer >> bits) & 0xff;
      outputIndex += 1;
    }
  }
  return output;
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  const arrayBufferMethod: unknown = Reflect.get(blob, "arrayBuffer");
  if (typeof arrayBufferMethod === "function") {
    const result: unknown = await Reflect.apply(arrayBufferMethod, blob, []);
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
  }
  if (typeof FileReader !== "undefined") {
    const result = await new Promise<string | ArrayBuffer>(
      (resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => {
          if (reader.result === null) {
            reject(new Error("The uploaded timetable file could not be read."));
          } else {
            resolve(reader.result);
          }
        });
        reader.addEventListener("error", () => {
          reject(
            reader.error ??
              new Error("The uploaded timetable file could not be read."),
          );
        });
        reader.readAsArrayBuffer(blob);
      },
    );
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
  }
  throw new Error("This environment cannot read Blob data for backup export.");
}

async function serializeUploadReference(
  reference: UploadedTimetableReference,
): Promise<SerializedUploadedTimetableReference> {
  const bytes = await readBlobBytes(reference.blob);
  if (bytes.byteLength !== reference.size) {
    throw new Error(
      `Uploaded timetable reference ${reference.id} has inconsistent size metadata.`,
    );
  }
  return {
    id: reference.id,
    profileId: reference.profileId,
    semesterId: reference.semesterId,
    filename: reference.filename,
    mediaType: reference.mediaType,
    size: reference.size,
    blobBase64: bytesToBase64(bytes),
    rotation: reference.rotation,
    zoom: reference.zoom,
    crop: { ...reference.crop },
    createdAt: reference.createdAt,
    updatedAt: reference.updatedAt,
  };
}

function deserializeUploadReference(
  reference: SerializedUploadedTimetableReference,
): UploadedTimetableReference {
  const bytes = base64ToBytes(reference.blobBase64);
  if (bytes.byteLength !== reference.size) {
    throw new Error(
      `Uploaded timetable reference ${reference.id} failed its size check.`,
    );
  }
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  return {
    id: reference.id,
    profileId: reference.profileId,
    semesterId: reference.semesterId,
    filename: reference.filename,
    mediaType: reference.mediaType,
    size: reference.size,
    blob: new Blob([blobBytes.buffer], { type: reference.mediaType }),
    rotation: reference.rotation,
    zoom: reference.zoom,
    crop: { ...reference.crop },
    createdAt: reference.createdAt,
    updatedAt: reference.updatedAt,
  };
}

function scopedSettings(
  settings: AppSettings,
  profileId: string | undefined,
  semesterIds: ReadonlySet<string>,
): AppSettings {
  if (!profileId) return settings;
  return {
    ...settings,
    activeProfileId: profileId,
    activeSemesterId:
      settings.activeSemesterId && semesterIds.has(settings.activeSemesterId)
        ? settings.activeSemesterId
        : undefined,
  };
}

export async function createBackup(
  database: AttendSafeDatabase,
  options: ExportBackupOptions = {},
): Promise<AttendSafeBackupFile> {
  const allProfiles = await database.profiles.toArray();
  const profiles = options.profileId
    ? allProfiles.filter((profile) => profile.id === options.profileId)
    : allProfiles;
  if (options.profileId && profiles.length === 0) {
    throw new Error(`Profile ${options.profileId} does not exist.`);
  }
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const semesters = (await database.semesters.toArray()).filter((semester) =>
    profileIds.has(semester.profileId),
  );
  const semesterIds = new Set(semesters.map((semester) => semester.id));
  const timetables = (await database.timetables.toArray()).filter((timetable) =>
    semesterIds.has(timetable.semesterId),
  );
  const timetableIds = new Set(timetables.map((timetable) => timetable.id));
  const timetableVersions = (await database.timetableVersions.toArray()).filter(
    (version) =>
      semesterIds.has(version.semesterId) &&
      timetableIds.has(version.timetableId),
  );
  const versionIds = new Set(timetableVersions.map((version) => version.id));
  const subjects = (await database.subjects.toArray()).filter((subject) =>
    semesterIds.has(subject.semesterId),
  );
  const electiveGroups = (await database.electiveGroups.toArray()).filter(
    (group) => semesterIds.has(group.semesterId),
  );
  const timetableSlots = (await database.timetableSlots.toArray()).filter(
    (slot) => versionIds.has(slot.timetableVersionId),
  );
  const academicExceptions = (
    await database.academicExceptions.toArray()
  ).filter((exception) => semesterIds.has(exception.semesterId));
  const classSessions = (await database.classSessions.toArray()).filter(
    (session) => semesterIds.has(session.semesterId),
  );
  const sessionIds = new Set(classSessions.map((session) => session.id));
  const attendanceRecords = (await database.attendanceRecords.toArray()).filter(
    (record) => sessionIds.has(record.classSessionId),
  );
  const referencedUploadIds = new Set(
    timetableVersions.flatMap((version) =>
      version.uploadedReferenceId ? [version.uploadedReferenceId] : [],
    ),
  );
  const uploadReferences = (
    await database.uploadedTimetableReferences.toArray()
  ).filter(
    (reference) =>
      referencedUploadIds.has(reference.id) ||
      (reference.profileId ? profileIds.has(reference.profileId) : false) ||
      (reference.semesterId ? semesterIds.has(reference.semesterId) : false),
  );
  const uploadedTimetableReferences = await Promise.all(
    uploadReferences.map(serializeUploadReference),
  );
  const currentSettings =
    (await database.appSettings.get("app")) ?? defaultAppSettings();
  const appSettings = [
    scopedSettings(currentSettings, options.profileId, semesterIds),
  ];
  const recentActions =
    options.includeRecentActions === false
      ? []
      : (await database.recentActions.toArray()).filter((action) =>
          profileIds.has(action.profileId),
        );

  return attendSafeBackupSchema.parse({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    product: "AttendSafe",
    data: {
      profiles,
      semesters,
      timetables,
      timetableVersions,
      subjects,
      electiveGroups,
      timetableSlots,
      academicExceptions,
      classSessions,
      attendanceRecords,
      appSettings,
      recentActions,
      uploadedTimetableReferences,
    },
  });
}

export async function exportBackupJson(
  database: AttendSafeDatabase,
  options: ExportBackupOptions = {},
): Promise<string> {
  const backup = await createBackup(database, options);
  return JSON.stringify(backup, null, options.pretty === false ? undefined : 2);
}

export function parseBackupJson(json: string): AttendSafeBackupFile {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  return parseAndMigrateBackup(value);
}

export async function importBackup(
  database: AttendSafeDatabase,
  input: string | unknown,
  options: ImportBackupOptions = {},
): Promise<AttendSafeBackupFile> {
  const parsed =
    typeof input === "string"
      ? parseBackupJson(input)
      : parseAndMigrateBackup(input);
  const uploadReferences = parsed.data.uploadedTimetableReferences.map(
    deserializeUploadReference,
  );
  const data = parsed.data;

  try {
    await database.transaction("rw", TABLE_NAMES, async () => {
      if (options.mode === "REPLACE") {
        for (const tableName of [...TABLE_NAMES].reverse()) {
          await database.table(tableName).clear();
        }
      }
      await database.profiles.bulkPut(data.profiles);
      await database.semesters.bulkPut(data.semesters);
      await database.timetables.bulkPut(data.timetables);
      await database.timetableVersions.bulkPut(data.timetableVersions);
      await database.subjects.bulkPut(data.subjects);
      await database.electiveGroups.bulkPut(data.electiveGroups);
      await database.timetableSlots.bulkPut(data.timetableSlots);
      await database.academicExceptions.bulkPut(data.academicExceptions);
      await database.classSessions.bulkPut(data.classSessions);
      await database.attendanceRecords.bulkPut(data.attendanceRecords);
      await database.uploadedTimetableReferences.bulkPut(uploadReferences);
      await database.recentActions.bulkPut(data.recentActions);
      if (data.appSettings[0]) {
        await database.appSettings.put(data.appSettings[0]);
      } else if (options.mode === "REPLACE") {
        await database.appSettings.put(defaultAppSettings());
      }
    });
  } catch (error) {
    throw normalizeDatabaseError(error);
  }
  return parsed;
}
