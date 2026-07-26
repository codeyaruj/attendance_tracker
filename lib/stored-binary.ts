export type StoredBinary = Blob | Uint8Array;

export function storedBinarySize(value: StoredBinary): number {
  return value instanceof Uint8Array ? value.byteLength : value.size;
}

export async function storedBinaryBytes(
  value: StoredBinary,
): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  return new Uint8Array(await value.arrayBuffer());
}
