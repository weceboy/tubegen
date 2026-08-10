import crypto from 'node:crypto';

/**
 * Deterministic JSON serialization: object keys are sorted recursively so
 * the same logical value always produces the same string, regardless of
 * property insertion order.
 *
 * This is the single source of truth for how the production integrity
 * chain (snapshot -> manifest -> plan -> render output -> publish ->
 * release -> delivery) canonicalizes data before hashing. Every module in
 * that chain must use this function (or `sha256` below) rather than a
 * local copy or raw `JSON.stringify` - a hash computed any other way is not
 * guaranteed to be reproducible and breaks the chain's verification
 * guarantees.
 */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

/**
 * Hashes a value with SHA-256. Objects/arrays/primitives are canonicalized
 * first (see `canonical` above). A raw string is hashed as-is, without
 * re-serializing it - this matters when the string is already a stored,
 * canonical JSON payload (e.g. a persisted `payload_json` column): hashing
 * it directly is the checksum of exactly what is stored, whereas running it
 * through `canonical()` again would JSON-encode the string a second time
 * and produce a different, less meaningful digest.
 */
export function sha256(value) {
  const material = typeof value === 'string' ? value : canonical(value);
  return crypto.createHash('sha256').update(material).digest('hex');
}
