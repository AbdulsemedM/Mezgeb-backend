/**
 * RFC 8785 JSON Canonicalization Scheme (JCS), used for the entry signing payload and the
 * chain hash (ADR-001).
 *
 * - Object keys sorted by UTF-16 code units (JavaScript's default string order).
 * - Strings and numbers serialized as ECMAScript JSON.stringify does (RFC 8785 §3.2.2).
 * - No whitespace.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('JCS: numbers must be finite');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return `{${keys
        .map((k) => {
          if (obj[k] === undefined)
            throw new Error(`JCS: undefined value at key ${JSON.stringify(k)}`);
          return `${JSON.stringify(k)}:${canonicalize(obj[k])}`;
        })
        .join(',')}}`;
    }
    default:
      throw new Error(`JCS: cannot serialize ${typeof value}`);
  }
}

/** UTF-8 bytes of the canonical form. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
