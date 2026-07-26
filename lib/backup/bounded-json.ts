import { BACKUP_LIMITS } from "@/lib/validation/backup-limits";
import { BackupError } from "./backup-errors";

interface StackEntry {
  value: unknown;
  depth: number;
  path: string;
}

export interface TraversalSummary {
  objects: number;
  arrayElements: number;
  stringCharacters: number;
}

export function assertBoundedValue(root: unknown): TraversalSummary {
  const stack: StackEntry[] = [{ value: root, depth: 0, path: "$" }];
  const seen = new WeakSet<object>();
  let objects = 0;
  let arrayElements = 0;
  let stringCharacters = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > BACKUP_LIMITS.maxDepth) {
      throw new BackupError(
        "LIMIT_EXCEEDED",
        `The backup exceeds the maximum nesting depth of ${BACKUP_LIMITS.maxDepth}.`,
        { path: current.path },
      );
    }
    if (typeof current.value === "string") {
      if (current.value.length > BACKUP_LIMITS.maxStringLength) {
        throw new BackupError(
          "LIMIT_EXCEEDED",
          "The backup contains an excessively long text value.",
          { path: current.path },
        );
      }
      stringCharacters += current.value.length;
      if (stringCharacters > BACKUP_LIMITS.maxTotalStringCharacters) {
        throw new BackupError(
          "LIMIT_EXCEEDED",
          "The backup contains too much text data.",
        );
      }
      continue;
    }
    if (typeof current.value !== "object" || current.value === null) continue;
    if (seen.has(current.value)) {
      throw new BackupError(
        "LIMIT_EXCEEDED",
        "The backup contains a cyclic object graph.",
        { path: current.path },
      );
    }
    seen.add(current.value);
    objects += 1;
    if (objects > BACKUP_LIMITS.maxObjects) {
      throw new BackupError(
        "LIMIT_EXCEEDED",
        "The backup contains too many objects.",
      );
    }

    if (Array.isArray(current.value)) {
      if (current.value.length > BACKUP_LIMITS.maxArrayLength) {
        throw new BackupError(
          "LIMIT_EXCEEDED",
          "The backup contains an excessively large array.",
          { path: current.path },
        );
      }
      arrayElements += current.value.length;
      if (arrayElements > BACKUP_LIMITS.maxTotalArrayElements) {
        throw new BackupError(
          "LIMIT_EXCEEDED",
          "The backup contains too many array entries.",
        );
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current.value[index],
          depth: current.depth + 1,
          path: `${current.path}[${index}]`,
        });
      }
      continue;
    }

    const entries = Object.entries(current.value);
    if (entries.length > BACKUP_LIMITS.maxObjectKeys) {
      throw new BackupError(
        "LIMIT_EXCEEDED",
        "The backup contains an object with too many properties.",
        { path: current.path },
      );
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, value] = entries[index];
      stack.push({
        value,
        depth: current.depth + 1,
        path: `${current.path}.${key}`,
      });
    }
  }
  return { objects, arrayElements, stringCharacters };
}

export function parseBoundedJson(json: string): unknown {
  if (json.length === 0) {
    throw new BackupError("FILE_EMPTY", "The selected backup is empty.");
  }
  if (json.length > BACKUP_LIMITS.maxJsonCharacters) {
    throw new BackupError(
      "LIMIT_EXCEEDED",
      "The backup text exceeds the 5,000,000-character safety limit.",
    );
  }
  const first = json.trimStart()[0];
  if (first !== "{") {
    throw new BackupError(
      "INVALID_JSON",
      "The selected file is not an AttendSafe JSON object.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (cause) {
    throw new BackupError(
      "INVALID_JSON",
      "The selected file is not valid JSON.",
      {},
      { cause },
    );
  }
  assertBoundedValue(value);
  return value;
}
