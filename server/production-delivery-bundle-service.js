import crypto from 'node:crypto';
import { db, now, tx } from './db.js';
import { verifyProductionRelease } from './production-release-service.js';
import { verifyProductionDeliveryPackage } from './production-delivery-package-service.js';
import { sha256 as sha } from './hash.js';

const SCHEMA = 'production-delivery-bundle/v4.5';

function ensureTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_delivery_bundles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      release_id TEXT NOT NULL REFERENCES production_releases(id) ON DELETE CASCADE,
      package_id TEXT NOT NULL REFERENCES production_delivery_packages(id) ON DELETE CASCADE,
      bundle_hash TEXT NOT NULL,
      bundle_name TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'manifested-directory',
      payload_json TEXT NOT NULL,
      entry_count INTEGER NOT NULL,
      total_size INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','verified','exported')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      verified_at TEXT,
      exported_at TEXT,
      export_reference TEXT,
      UNIQUE(project_id, release_id)
    );
    CREATE TABLE IF NOT EXISTS production_delivery_bundle_entries (
      id TEXT PRIMARY KEY,
      bundle_id TEXT NOT NULL REFERENCES production_delivery_bundles(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      role TEXT NOT NULL,
      object_key TEXT NOT NULL,
      checksum TEXT NOT NULL,
      size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      source_package_item_id TEXT NOT NULL REFERENCES production_delivery_package_items(id) ON DELETE CASCADE,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(bundle_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_production_delivery_bundles_project
      ON production_delivery_bundles(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_production_delivery_bundle_entries_bundle
      ON production_delivery_bundle_entries(bundle_id, path);
  `);
}

function getBundle(projectId, bundleId) {
  return db.prepare('SELECT * FROM production_delivery_bundles WHERE id=? AND project_id=?').get(bundleId, projectId);
}

function entries(bundleId) {
  return db.prepare('SELECT * FROM production_delivery_bundle_entries WHERE bundle_id=? ORDER BY path').all(bundleId);
}

function canonicalEntry(item) {
  const safeRole = item.role.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const extension = item.mime_type === 'application/json' ? 'json' : (item.mime_type.split('/')[1] || 'bin').replace(/[^a-z0-9.+-]/gi, '');
  return {
    path: `artifacts/${safeRole}.${extension}`,
    role: item.role,
    objectKey: item.object_key,
    checksum: item.checksum,
    size: Number(item.size || 0),
    mimeType: item.mime_type || 'application/octet-stream',
    sourcePackageItemId: item.id,
    metadata: JSON.parse(item.metadata_json || '{}')
  };
}

function buildPayload(projectId, release, pkg, packageVerification) {
  const packagePayload = packageVerification.payload;
  const packageItems = packageVerification.artifacts;
  const bundleEntries = packageItems.map(canonicalEntry).sort((a, b) => a.path.localeCompare(b.path));
  const duplicatePaths = bundleEntries.filter((entry, index) => index && entry.path === bundleEntries[index - 1].path);
  if (duplicatePaths.length) throw new Error('Delivery bundle contains duplicate canonical paths');
  const totalSize = bundleEntries.reduce((sum, entry) => sum + entry.size, 0);
  const entryDescriptors = bundleEntries.map(({ path, role, objectKey, checksum, size, mimeType }) => ({ path, role, objectKey, checksum, size, mimeType }));
  return {
    schema: SCHEMA,
    projectId,
    release: { id: release.id, number: release.release_number, manifestHash: release.manifest_hash },
    package: { id: pkg.id, packageHash: pkg.package_hash, schema: packagePayload.schema },
    bundleName: `production-release-${release.release_number}-${pkg.id}.bundle`,
    format: 'manifested-directory',
    entries: entryDescriptors,
    entryCount: entryDescriptors.length,
    totalSize,
    contentHash: sha(entryDescriptors),
    sourcePackageItemIds: bundleEntries.map(entry => entry.sourcePackageItemId)
  };
}

export function createProductionDeliveryBundle(projectId, releaseId, { actorId = 'system' } = {}) {
  ensureTables();
  const releaseVerification = verifyProductionRelease(projectId, releaseId);
  if (!releaseVerification.ok) throw new Error(`Production delivery bundle blocked: ${releaseVerification.reason}`);
  const existing = db.prepare('SELECT * FROM production_delivery_bundles WHERE project_id=? AND release_id=?').get(projectId, releaseId);
  if (existing) return existing;

  const pkg = db.prepare('SELECT * FROM production_delivery_packages WHERE project_id=? AND release_id=?').get(projectId, releaseId);
  if (!pkg) throw new Error('Production delivery package is required before bundling');
  const packageVerification = verifyProductionDeliveryPackage(projectId, pkg.id);
  if (!packageVerification.ok) throw new Error(`Production delivery bundle blocked: ${packageVerification.reason}`);

  const payload = buildPayload(projectId, releaseVerification.release, pkg, packageVerification);
  const bundleHash = sha(payload);
  const bundleId = `delivery_bundle_${crypto.randomUUID()}`;
  const createdAt = now();
  tx(() => {
    db.prepare(`INSERT INTO production_delivery_bundles
      (id,project_id,release_id,package_id,bundle_hash,bundle_name,format,payload_json,entry_count,total_size,status,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      bundleId, projectId, releaseId, pkg.id, bundleHash, payload.bundleName, payload.format,
      JSON.stringify(payload), payload.entryCount, payload.totalSize, 'created', actorId, createdAt
    );
    for (const item of packageVerification.artifacts.map(canonicalEntry)) {
      db.prepare(`INSERT INTO production_delivery_bundle_entries
        (id,bundle_id,path,role,object_key,checksum,size,mime_type,source_package_item_id,metadata_json)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        `delivery_bundle_entry_${crypto.randomUUID()}`, bundleId, item.path, item.role, item.objectKey,
        item.checksum, item.size, item.mimeType, item.sourcePackageItemId, JSON.stringify(item.metadata)
      );
    }
    db.prepare(`INSERT INTO audit_events
      (id,project_id,actor_id,event_type,entity_id,created_at,metadata)
      VALUES(?,?,?,?,?,?,?)`).run(
      `audit_${crypto.randomUUID()}`, projectId, actorId, 'production.delivery-bundle.created', bundleId, createdAt,
      JSON.stringify({ releaseId, packageId: pkg.id, bundleId, bundleHash, entryCount: payload.entryCount })
    );
  });
  return getBundle(projectId, bundleId);
}

export function verifyProductionDeliveryBundle(projectId, bundleId) {
  ensureTables();
  const bundle = getBundle(projectId, bundleId);
  if (!bundle) return { ok: false, status: 'missing', reason: 'Production delivery bundle not found' };
  let payload;
  try { payload = JSON.parse(bundle.payload_json); } catch {
    return { ok: false, status: 'drifted', reason: 'Delivery bundle payload is invalid JSON', bundle };
  }
  if (sha(payload) !== bundle.bundle_hash) return { ok: false, status: 'drifted', reason: 'Delivery bundle hash mismatch', bundle };

  const releaseVerification = verifyProductionRelease(projectId, bundle.release_id);
  if (!releaseVerification.ok) return { ok: false, status: releaseVerification.status === 'revoked' ? 'revoked' : 'drifted', reason: `Release verification failed: ${releaseVerification.reason}`, bundle };
  const packageVerification = verifyProductionDeliveryPackage(projectId, bundle.package_id);
  if (!packageVerification.ok) return { ok: false, status: packageVerification.status === 'revoked' ? 'revoked' : 'drifted', reason: `Package verification failed: ${packageVerification.reason}`, bundle };

  const expected = buildPayload(projectId, releaseVerification.release, packageVerification.package, packageVerification);
  if (JSON.stringify(payload) !== JSON.stringify(expected)) return { ok: false, status: 'drifted', reason: 'Delivery bundle payload no longer matches package lineage', bundle };
  if (bundle.entry_count !== expected.entryCount || bundle.total_size !== expected.totalSize) return { ok: false, status: 'drifted', reason: 'Delivery bundle aggregate metadata drifted', bundle };

  const persistedEntries = entries(bundle.id);
  if (persistedEntries.length !== expected.entryCount) return { ok: false, status: 'drifted', reason: 'Delivery bundle entry count mismatch', bundle };
  for (const expectedEntry of expected.entries) {
    const entry = persistedEntries.find(row => row.path === expectedEntry.path);
    if (!entry || entry.role !== expectedEntry.role || entry.object_key !== expectedEntry.objectKey || entry.checksum !== expectedEntry.checksum || entry.size !== expectedEntry.size || entry.mime_type !== expectedEntry.mimeType) {
      return { ok: false, status: 'drifted', reason: `Delivery bundle entry drift: ${expectedEntry.path}`, bundle };
    }
  }
  if (bundle.status === 'created') db.prepare("UPDATE production_delivery_bundles SET status='verified',verified_at=? WHERE id=? AND status='created'").run(now(), bundle.id);
  return { ok: true, status: 'valid', bundle: getBundle(projectId, bundle.id), payload, entries: persistedEntries };
}

export function exportProductionDeliveryBundle(projectId, bundleId, exportReference, { actorId = 'system' } = {}) {
  ensureTables();
  if (!exportReference || !String(exportReference).trim()) throw new Error('Bundle export reference is required');
  const verification = verifyProductionDeliveryBundle(projectId, bundleId);
  if (!verification.ok) throw new Error(`Production delivery bundle export blocked: ${verification.reason}`);
  const bundle = getBundle(projectId, bundleId);
  if (bundle.status === 'exported') return bundle;
  const exportedAt = now();
  tx(() => {
    db.prepare(`UPDATE production_delivery_bundles SET status='exported',exported_at=?,export_reference=? WHERE id=? AND status IN ('created','verified')`)
      .run(exportedAt, String(exportReference).trim(), bundleId);
    db.prepare(`INSERT INTO audit_events
      (id,project_id,actor_id,event_type,entity_id,created_at,metadata)
      VALUES(?,?,?,?,?,?,?)`).run(
      `audit_${crypto.randomUUID()}`, projectId, actorId, 'production.delivery-bundle.exported', bundleId, exportedAt,
      JSON.stringify({ bundleId, exportReference: String(exportReference).trim(), bundleHash: bundle.bundle_hash })
    );
  });
  return getBundle(projectId, bundleId);
}

export function getProductionDeliveryBundle(projectId, bundleId) {
  ensureTables();
  return getBundle(projectId, bundleId);
}

export function listProductionDeliveryBundles(projectId) {
  ensureTables();
  return db.prepare('SELECT * FROM production_delivery_bundles WHERE project_id=? ORDER BY created_at DESC').all(projectId);
}
