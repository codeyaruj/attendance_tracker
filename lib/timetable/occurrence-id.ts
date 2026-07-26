const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function hash32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

/**
 * Builds a stable RFC 4122-shaped UUID for a lazily resolved occurrence.
 * Version 8 marks the payload as application-defined while the variant bits
 * remain standards-compliant. This is an identity hash, not a security hash.
 */
export function createOccurrenceId(
  source: "TIMETABLE" | "EXTRA" | "RESCHEDULED",
  sourceEntityId: string,
  date: string,
): string {
  if (!sourceEntityId.trim())
    throw new Error("Occurrence source ID is required.");
  if (!ISO_DATE.test(date))
    throw new Error("Occurrence date must use YYYY-MM-DD.");
  const input = `${source}\u0000${sourceEntityId}\u0000${date}`;
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const bytes = seeds.flatMap((seed) => {
    const word = hash32(input, seed);
    return [word >>> 24, word >>> 16, word >>> 8, word].map(
      (value) => value & 0xff,
    );
  });
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
