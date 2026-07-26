import { BACKUP_LIMITS } from "@/lib/validation/backup-limits";
import { BackupError } from "./backup-errors";
import type {
  CanonicalBackupData,
  SerializedUploadedTimetableReference,
} from "./schema";

interface ValidationIssue {
  code: "DUPLICATE_ID" | "REFERENCE_INVALID" | "SCHEMA_INVALID";
  path: string;
  message: string;
}

function decodedBase64Size(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function base64Prefix(value: string): Uint8Array {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = value.slice(0, 24).replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of clean) {
    buffer = (buffer << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function uploadSignatureMatches(
  reference: SerializedUploadedTimetableReference,
): boolean {
  const bytes = base64Prefix(reference.blobBase64);
  if (reference.mediaType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (reference.mediaType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    );
  }
  const text = new TextDecoder("ascii").decode(bytes);
  if (reference.mediaType === "image/webp") {
    return text.slice(0, 4) === "RIFF" && text.slice(8, 12) === "WEBP";
  }
  return text.slice(0, 5) === "%PDF-";
}

function throwIssues(issues: readonly ValidationIssue[]): never {
  const first = issues[0];
  throw new BackupError(first.code, `${first.message} (${first.path})`, {
    path: first.path,
    details: issues
      .slice(0, BACKUP_LIMITS.maxValidationErrors)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("\n"),
  });
}

export function validateBackupRelationships(data: CanonicalBackupData): void {
  const issues: ValidationIssue[] = [];
  const add = (
    code: ValidationIssue["code"],
    path: string,
    message: string,
  ) => {
    if (issues.length < BACKUP_LIMITS.maxValidationErrors) {
      issues.push({ code, path, message });
    }
  };
  const collections = [
    ["profiles", data.profiles],
    ["semesters", data.semesters],
    ["timetables", data.timetables],
    ["timetableVersions", data.timetableVersions],
    ["subjects", data.subjects],
    ["electiveGroups", data.electiveGroups],
    ["timetableSlots", data.timetableSlots],
    ["academicExceptions", data.academicExceptions],
    ["classSessions", data.classSessions],
    ["attendanceRecords", data.attendanceRecords],
    ["uploadedTimetableReferences", data.uploadedTimetableReferences],
    ["recentActions", data.recentActions],
  ] as const;
  for (const [name, records] of collections) {
    const seen = new Set<string>();
    records.forEach((record, index) => {
      if (seen.has(record.id)) {
        add("DUPLICATE_ID", `data.${name}.${index}.id`, `Duplicate ${name} ID`);
      }
      seen.add(record.id);
    });
  }

  const profiles = new Map(data.profiles.map((item) => [item.id, item]));
  const semesters = new Map(data.semesters.map((item) => [item.id, item]));
  const timetables = new Map(data.timetables.map((item) => [item.id, item]));
  const versions = new Map(
    data.timetableVersions.map((item) => [item.id, item]),
  );
  const subjects = new Map(data.subjects.map((item) => [item.id, item]));
  const groups = new Map(data.electiveGroups.map((item) => [item.id, item]));
  const slots = new Map(data.timetableSlots.map((item) => [item.id, item]));
  const sessions = new Map(data.classSessions.map((item) => [item.id, item]));
  const uploads = new Set(
    data.uploadedTimetableReferences.map((item) => item.id),
  );

  data.semesters.forEach((item, index) => {
    if (!profiles.has(item.profileId))
      add(
        "REFERENCE_INVALID",
        `data.semesters.${index}.profileId`,
        "Unknown profile",
      );
    if (
      item.activeTimetableVersionId &&
      versions.get(item.activeTimetableVersionId)?.semesterId !== item.id
    ) {
      add(
        "REFERENCE_INVALID",
        `data.semesters.${index}.activeTimetableVersionId`,
        "Active timetable version is missing or belongs to another semester",
      );
    }
  });
  data.timetables.forEach((item, index) => {
    if (!semesters.has(item.semesterId))
      add(
        "REFERENCE_INVALID",
        `data.timetables.${index}.semesterId`,
        "Unknown semester",
      );
  });
  const versionNumbers = new Set<string>();
  data.timetableVersions.forEach((item, index) => {
    const key = `${item.timetableId}:${item.version}`;
    if (versionNumbers.has(key))
      add(
        "DUPLICATE_ID",
        `data.timetableVersions.${index}.version`,
        "Duplicate timetable version number",
      );
    versionNumbers.add(key);
    if (timetables.get(item.timetableId)?.semesterId !== item.semesterId)
      add(
        "REFERENCE_INVALID",
        `data.timetableVersions.${index}.timetableId`,
        "Timetable is missing or belongs to another semester",
      );
    if (!semesters.has(item.semesterId))
      add(
        "REFERENCE_INVALID",
        `data.timetableVersions.${index}.semesterId`,
        "Unknown semester",
      );
    if (item.uploadedReferenceId && !uploads.has(item.uploadedReferenceId))
      add(
        "REFERENCE_INVALID",
        `data.timetableVersions.${index}.uploadedReferenceId`,
        "Unknown uploaded timetable source",
      );
  });
  data.subjects.forEach((item, index) => {
    if (!semesters.has(item.semesterId))
      add(
        "REFERENCE_INVALID",
        `data.subjects.${index}.semesterId`,
        "Unknown semester",
      );
  });
  data.electiveGroups.forEach((item, index) => {
    if (!semesters.has(item.semesterId))
      add(
        "REFERENCE_INVALID",
        `data.electiveGroups.${index}.semesterId`,
        "Unknown semester",
      );
    const options = new Set(item.options.map((option) => option.subjectId));
    for (const subjectId of [...options, ...item.selectedSubjectIds]) {
      if (subjects.get(subjectId)?.semesterId !== item.semesterId)
        add(
          "REFERENCE_INVALID",
          `data.electiveGroups.${index}`,
          "Elective subject is missing or belongs to another semester",
        );
    }
    if (item.selectedSubjectIds.some((id) => !options.has(id)))
      add(
        "REFERENCE_INVALID",
        `data.electiveGroups.${index}.selectedSubjectIds`,
        "Selected elective is not an option",
      );
  });
  data.timetableSlots.forEach((item, index) => {
    const semesterId = versions.get(item.timetableVersionId)?.semesterId;
    if (!semesterId)
      add(
        "REFERENCE_INVALID",
        `data.timetableSlots.${index}.timetableVersionId`,
        "Unknown timetable version",
      );
    if (
      item.subjectId &&
      subjects.get(item.subjectId)?.semesterId !== semesterId
    )
      add(
        "REFERENCE_INVALID",
        `data.timetableSlots.${index}.subjectId`,
        "Slot subject is missing or belongs to another semester",
      );
    if (
      item.electiveGroupId &&
      groups.get(item.electiveGroupId)?.semesterId !== semesterId
    )
      add(
        "REFERENCE_INVALID",
        `data.timetableSlots.${index}.electiveGroupId`,
        "Slot elective group is missing or belongs to another semester",
      );
  });
  data.classSessions.forEach((item, index) => {
    const semester = semesters.get(item.semesterId);
    if (!semester)
      add(
        "REFERENCE_INVALID",
        `data.classSessions.${index}.semesterId`,
        "Unknown semester",
      );
    if (subjects.get(item.subjectId)?.semesterId !== item.semesterId)
      add(
        "REFERENCE_INVALID",
        `data.classSessions.${index}.subjectId`,
        "Session subject is missing or belongs to another semester",
      );
    if (
      item.date < (semester?.startDate ?? item.date) ||
      item.date > (semester?.endDate ?? item.date)
    )
      add(
        "SCHEMA_INVALID",
        `data.classSessions.${index}.date`,
        "Session date falls outside its semester",
      );
    if (item.timetableSlotId && !slots.has(item.timetableSlotId))
      add(
        "REFERENCE_INVALID",
        `data.classSessions.${index}.timetableSlotId`,
        "Unknown timetable slot",
      );
    if (
      item.timetableVersionId &&
      versions.get(item.timetableVersionId)?.semesterId !== item.semesterId
    )
      add(
        "REFERENCE_INVALID",
        `data.classSessions.${index}.timetableVersionId`,
        "Session timetable version is missing or belongs to another semester",
      );
  });
  const attendanceSessions = new Set<string>();
  data.attendanceRecords.forEach((item, index) => {
    if (attendanceSessions.has(item.classSessionId))
      add(
        "DUPLICATE_ID",
        `data.attendanceRecords.${index}.classSessionId`,
        "Duplicate attendance for one class occurrence",
      );
    attendanceSessions.add(item.classSessionId);
    if (!sessions.has(item.classSessionId))
      add(
        "REFERENCE_INVALID",
        `data.attendanceRecords.${index}.classSessionId`,
        "Unknown class session",
      );
  });
  data.academicExceptions.forEach((item, index) => {
    const semester = semesters.get(item.semesterId);
    if (!semester)
      add(
        "REFERENCE_INVALID",
        `data.academicExceptions.${index}.semesterId`,
        "Unknown semester",
      );
    if (
      item.startDate < (semester?.startDate ?? item.startDate) ||
      item.endDate > (semester?.endDate ?? item.endDate)
    )
      add(
        "SCHEMA_INVALID",
        `data.academicExceptions.${index}`,
        "Exception falls outside its semester",
      );
    if (item.timetableSlotId && !slots.has(item.timetableSlotId))
      add(
        "REFERENCE_INVALID",
        `data.academicExceptions.${index}.timetableSlotId`,
        "Unknown timetable slot",
      );
    if (
      item.classSessionId &&
      sessions.get(item.classSessionId)?.semesterId !== item.semesterId
    )
      add(
        "REFERENCE_INVALID",
        `data.academicExceptions.${index}.classSessionId`,
        "Exception session is missing or belongs to another semester",
      );
    if (
      item.subjectId &&
      subjects.get(item.subjectId)?.semesterId !== item.semesterId
    )
      add(
        "REFERENCE_INVALID",
        `data.academicExceptions.${index}.subjectId`,
        "Exception subject is missing or belongs to another semester",
      );
  });
  data.uploadedTimetableReferences.forEach((item, index) => {
    if (item.profileId && !profiles.has(item.profileId))
      add(
        "REFERENCE_INVALID",
        `data.uploadedTimetableReferences.${index}.profileId`,
        "Unknown profile",
      );
    if (item.semesterId && !semesters.has(item.semesterId))
      add(
        "REFERENCE_INVALID",
        `data.uploadedTimetableReferences.${index}.semesterId`,
        "Unknown semester",
      );
    else if (
      item.profileId &&
      item.semesterId &&
      semesters.get(item.semesterId)?.profileId !== item.profileId
    )
      add(
        "REFERENCE_INVALID",
        `data.uploadedTimetableReferences.${index}.semesterId`,
        "Upload semester does not match its profile",
      );
  });
  data.recentActions.forEach((item, index) => {
    if (!profiles.has(item.profileId))
      add(
        "REFERENCE_INVALID",
        `data.recentActions.${index}.profileId`,
        "Unknown profile",
      );
    if (
      item.semesterId &&
      semesters.get(item.semesterId)?.profileId !== item.profileId
    )
      add(
        "REFERENCE_INVALID",
        `data.recentActions.${index}.semesterId`,
        "Recent-action semester is missing or belongs to another profile",
      );
  });
  const settings = data.appSettings[0];
  if (settings.activeProfileId && !profiles.has(settings.activeProfileId))
    add(
      "REFERENCE_INVALID",
      "data.appSettings.0.activeProfileId",
      "Unknown active profile",
    );
  if (
    settings.activeSemesterId &&
    semesters.get(settings.activeSemesterId)?.profileId !==
      settings.activeProfileId
  )
    add(
      "REFERENCE_INVALID",
      "data.appSettings.0.activeSemesterId",
      "Active semester is missing or belongs to another profile",
    );

  let decodedTotal = 0;
  data.uploadedTimetableReferences.forEach((item, index) => {
    const size = decodedBase64Size(item.blobBase64);
    decodedTotal += size;
    if (size !== item.size)
      add(
        "SCHEMA_INVALID",
        `data.uploadedTimetableReferences.${index}.blobBase64`,
        "Embedded file size does not match its metadata",
      );
    if (!uploadSignatureMatches(item))
      add(
        "SCHEMA_INVALID",
        `data.uploadedTimetableReferences.${index}.blobBase64`,
        "Embedded file signature does not match its media type",
      );
  });
  if (decodedTotal > BACKUP_LIMITS.maxTotalDecodedBlobBytes)
    add(
      "SCHEMA_INVALID",
      "data.uploadedTimetableReferences",
      "Embedded files exceed the total decoded-size limit",
    );

  if (issues.length > 0) throwIssues(issues);
}
