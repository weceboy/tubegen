import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Storage abstraction. Database records should contain object_key only;
 * signed URLs are generated at request time and are never persisted.
 */
export class StorageError extends Error {
  constructor(message, { code = 'STORAGE_ERROR', retryable = false } = {}) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.retryable = retryable;
  }
}

export class ObjectStorage {
  async put(_input) {
    throw new StorageError('Storage provider not configured');
  }

  async get(_objectKey) {
    throw new StorageError('Storage provider not configured');
  }

  async signedUrl(_objectKey, _expiresSeconds = 900) {
    throw new StorageError('Storage provider not configured');
  }
}

/**
 * Strict "does this object key really belong to this project" check.
 *
 * A plain `objectKey.startsWith('renders/' + projectId + '/')` check (as
 * used to be duplicated across render-integrity.js) passes for keys like
 * `renders/project-A/../project-B/video.mp4`, which starts with the right
 * prefix as a string but escapes the project's namespace once the path is
 * normalized. This performs the same normalize-and-compare check the
 * storage layer uses for real filesystem paths, so the integrity chain
 * doesn't rely on a weaker copy of that guarantee.
 */
export function assertObjectKeyInProjectNamespace(objectKey, projectId, { prefix = 'renders' } = {}) {
  if (!objectKey || typeof objectKey !== 'string') return false;
  if (objectKey.includes('..') || path.isAbsolute(objectKey)) return false;
  const base = `${prefix}/${projectId}/`;
  const normalized = path.posix.normalize(objectKey);
  if (normalized !== objectKey) return false; // reject anything normalization would change
  return normalized.startsWith(base);
}

/** Local development implementation. Not intended as production storage. */
export class LocalObjectStorage extends ObjectStorage {
  constructor(root = process.env.AUTODOC_STORAGE_DIR || path.resolve('data/storage')) {
    super();
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  #safePath(objectKey) {
    if (!objectKey || objectKey.includes('..') || path.isAbsolute(objectKey)) {
      throw new StorageError('Invalid object key', { code: 'INVALID_OBJECT_KEY' });
    }
    const target = path.resolve(this.root, objectKey);
    if (!target.startsWith(path.resolve(this.root) + path.sep)) {
      throw new StorageError('Invalid object key', { code: 'INVALID_OBJECT_KEY' });
    }
    return target;
  }

  async put({ objectKey, data }) {
    const target = this.#safePath(objectKey);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, data);
    return { objectKey, size: Buffer.byteLength(data) };
  }

  async get(objectKey) {
    return fs.promises.readFile(this.#safePath(objectKey));
  }

  async signedUrl(objectKey, expiresSeconds = 900) {
    // Local URLs are intentionally opaque tokens. A production adapter should
    // delegate signing to S3/GCS/Azure and return their short-lived URL.
    const expiresAt = Date.now() + Math.max(1, expiresSeconds) * 1000;
    const token = crypto.createHash('sha256')
      .update(`${objectKey}:${expiresAt}:${process.env.AUTODOC_LOCAL_SIGNING_SECRET || 'development-only'}`)
      .digest('hex');
    return `/api/assets/${encodeURIComponent(objectKey)}?expires=${expiresAt}&token=${token}`;
  }
}
