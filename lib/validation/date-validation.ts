const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isStrictIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const reconstructed = new Date(Date.UTC(year, month - 1, day));
  return (
    reconstructed.getUTCFullYear() === year &&
    reconstructed.getUTCMonth() === month - 1 &&
    reconstructed.getUTCDate() === day
  );
}

export function isStrictLocalTime(value: string): boolean {
  return LOCAL_TIME_PATTERN.test(value);
}

export function isStrictTimestamp(value: string): boolean {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      value,
    );
  if (!match || !isStrictIsoDate(match[1])) {
    return false;
  }
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime());
}

export function isOrderedDateRange(
  startDate: string,
  endDate: string,
): boolean {
  return (
    isStrictIsoDate(startDate) &&
    isStrictIsoDate(endDate) &&
    endDate >= startDate
  );
}

export function isOrderedTimeRange(
  startTime: string,
  endTime: string,
): boolean {
  return (
    isStrictLocalTime(startTime) &&
    isStrictLocalTime(endTime) &&
    endTime > startTime
  );
}
