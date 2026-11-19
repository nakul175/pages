/** Shared by browser comparison and server validation; keep this module runtime-neutral. */
export function recordValueEmpty(value: unknown) {
  return value === undefined || value === null ||
    typeof value === 'string' && !value.trim() ||
    Array.isArray(value) && !value.length;
}
