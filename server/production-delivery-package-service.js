import crypto from 'node:crypto';
import { db, now, tx } from './db.js';
import { verifyProductionRelease } from './production-release-service.js';
import { verifyProductionDeliveryManifest } from './production-delivery-manifest-service.js';
import { verifyProductionPublish } from './production-delivery-service.js';
import { sha256 as sha } from './hash.js';

const SCHEMA = 'production-delivery-package/v4.4';

function ensureTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_delivery_packages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      release_id TEXT NOT NULL REFERENCES production_releases(id) ON DELETE CASCADE,
      delivery_manifest_id TEXT NOT NULL REFERENCES production_delivery_manifests(id) ON DELETE CASCADE,
      package_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      artifact_count INTEGER NOT NULL,
      total_size INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','verified','delivered')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      verified_at TEXT,
      delivered_at TEXT,
      delivery_reference TEXT,
      UNIQUE(project_id, release_id)
    );
    CREATE TABLE IF NOT EXISTS production_delivery_package_items (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL REFERENCES production_delivery_packages(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      object_key TEXT NOT NULL,
      checksum TEXT,
      size INTEGER,
      mime_type TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(package_id, role, object_key)
    );
    CREATE INDEX IF NOT EXISTS idx_production_delivery_packages_project
      ON production_delivery_packages(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_production_delivery_package_items_package
      ON production_delivery_package_items(package_id);
  `);
}

function getPackage(projectId, packageId) {
  return db.prepare('SELECT * FROM production_delivery_packages WHERE id=? AND project_id=?').get(packageId, projectId);
}

function currentItems(packageId) {
  return db.prepare('SELECT * FROM production_delivery_package_items WHERE package_id=? ORDER BY role, object_key').all(packageId);
}

function buildPayload(projectId, release, deliveryManifest, publishVerification) {
  const manifestPayload = JSON.parse(deliveryManifest.payload_json);
  const asset = db.prepare(`SELECT id, project_id, source_type, object_key, mime_type, checksum, size, duration_ms
    FROM scene_assets WHERE id=? AND project_id=?`).get(manifestPayload.publish.outputAssetId, projectId);
  if (!asset) throw new Error('Production output asset is missing');
  if (!asset.object_key) throw new Error('Production output asset has no storage object key');
  if (!asset.checksum || !/^[a-f0-9]{64}$/i.test(asset.checksum)) throw new Error('Production output asset requires a SHA-256 checksum');

  const manifestBytes = Buffer.byteLength(deliveryManifest.payload_json, 'utf8');
  const artifacts = [
    {
      role: 'delivery-manifest',
      objectKey: `manifests/${projectId}/${deliveryManifest.id}.json`,
      checksum: sha(deliveryManifest.payload_json),
      size: manifestBytes,
      mimeType: 'application/json',
      metadata: { manifestId: deliveryManifest.id, manifestHash: deliveryManifest.manifest_hash }
    },
    {
      role: 'production-output',
      objectKey: asset.object_key,
      checksum: asset.checksum,
      size: Number(asset.size || 0),
      mimeType: asset.mime_type || 'application/octet-stream',
      metadata: { assetId: asset.id, outputAssetId: manifestPayload.publish.outputAssetId }
    }
  ];

  artifacts.sort((a, b) => `${a.role}:${a.objectKey}`.localeCompare(`${b.role}:${b.objectKey}`));
  const totalSize = artifacts.reduce((sum, item) => sum + item.size, 0);
  return {
    schema: SCHEMA,
    projectId,
    release: {
      id: release.id,
      number: release.release_number,
      manifestHash: release.manifest_hash
    },
    deliveryManifest: {
      id: deliveryManifest.id,
      manifestHash: deliveryManifest.manifest_hash
    },
    publish: {
      id: publishVerification.publish.id,
      attestationHash: publishVerification.publish.attestation_hash
    },
    artifacts,
    artifactCount: artifacts.length,
    totalSize,
    packageContentHash: sha(artifacts.map(({ role, objectKey, checksum, size, mimeType }) => ({ role, objectKey, checksum, size, mimeType })))
  };
}

export function createProductionDeliveryPackage(projectId, releaseId, { actorId = 'system' } = {}) {
  ensureTables();
  const releaseVerification = verifyProductionRelease(projectId, releaseId);
  if (!releaseVerification.ok) throw new Error(`Production delivery package blocked: ${releaseVerification.reason}`);

  const deliveryManifest = db.prepare('SELECT * FROM production_delivery_manifests WHERE project_id=? AND release_id=?').get(projectId, releaseId);
  if (!deliveryManifest) throw new Error('Production delivery manifest is required before packaging');
  const manifestVerification = verifyProductionDeliveryManifest(projectId, deliveryManifest.id);
  if (!manifestVerification.ok) throw new Error(`Production delivery package blocked: ${manifestVerification.reason}`);
  const publishVerification = verifyProductionPublish(projectId, releaseVerification.release.publish_id);
  if (!publishVerification.ok) throw new Error(`Production delivery package blocked: ${publishVerification.reason}`);

  const existing = db.prepare('SELECT * FROM production_delivery_packages WHERE project_id=? AND release_id=?').get(projectId, releaseId);
  if (existing) return existing;

  const payload = buildPayload(projectId, releaseVerification.release, deliveryManifest, publishVerification);
  const packageHash = sha(payload);
  const packageId = `delivery_package_${crypto.randomUUID()}`;
  const createdAt = now();

  tx(() => {
    db.prepare(`INSERT INTO production_delivery_packages
      (id, project_id, release_id, delivery_manifest_id, package_hash, payload_json, artifact_count, total_size, status, created_by, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      packageId, projectId, releaseId, deliveryManifest.id, packageHash,
      JSON.stringify(payload), payload.artifactCount, payload.totalSize, 'created', actorId, createdAt
    );
    for (const item of payload.artifacts) {
      db.prepare(`INSERT INTO production_delivery_package_items
        (id, package_id, role, object_key, checksum, size, mime_type, metadata_json)
        VALUES(?,?,?,?,?,?,?,?)`).run(
        `delivery_item_${crypto.randomUUID()}`, packageId, item.role, item.objectKey,
        item.checksum, item.size, item.mimeType, JSON.stringify(item.metadata)
      );
    }
    db.prepare(`INSERT INTO audit_events
      (id, project_id, actor_id, event_type, entity_id, created_at, metadata)
      VALUES(?,?,?,?,?,?,?)`).run(
      `audit_${crypto.randomUUID()}`, projectId, actorId,
      'production.delivery-package.created', packageId, createdAt,
      JSON.stringify({ releaseId, packageId, packageHash, artifactCount: payload.artifactCount })
    );
  });

  return getPackage(projectId, packageId);
}

export function verifyProductionDeliveryPackage(projectId, packageId) {
  ensureTables();
  const pkg = getPackage(projectId, packageId);
  if (!pkg) return { ok: false, status: 'missing', reason: 'Production delivery package not found' };

  let payload;
  try { payload = JSON.parse(pkg.payload_json); } catch { return { ok: false, status: 'drifted', reason: 'Delivery package payload is invalid JSON', package: pkg }; }
  if (sha(payload) !== pkg.package_hash) return { ok: false, status: 'drifted', reason: 'Delivery package hash mismatch', package: pkg };

  const releaseVerification = verifyProductionRelease(projectId, pkg.release_id);
  if (!releaseVerification.ok) return { ok: false, status: releaseVerification.status === 'revoked' ? 'revoked' : 'drifted', reason: `Release verification failed: ${releaseVerification.reason}`, package: pkg };
  const manifestVerification = verifyProductionDeliveryManifest(projectId, pkg.delivery_manifest_id);
  if (!manifestVerification.ok) return { ok: false, status: manifestVerification.status === 'revoked' ? 'revoked' : 'drifted', reason: `Delivery manifest verification failed: ${manifestVerification.reason}`, package: pkg };
  const publishVerification = verifyProductionPublish(projectId, releaseVerification.release.publish_id);
  if (!publishVerification.ok) return { ok: false, status: 'drifted', reason: `Publish verification failed: ${publishVerification.reason}`, package: pkg };

  const expected = buildPayload(projectId, releaseVerification.release, manifestVerification.manifest, publishVerification);
  if (JSON.stringify(payload) !== JSON.stringify(expected)) return { ok: false, status: 'drifted', reason: 'Delivery package payload no longer matches persisted lineage', package: pkg };
  if (pkg.artifact_count !== expected.artifactCount || pkg.total_size !== expected.totalSize) return { ok: false, status: 'drifted', reason: 'Delivery package aggregate metadata drifted', package: pkg };

  const items = currentItems(pkg.id);
  if (items.length !== expected.artifactCount) return { ok: false, status: 'drifted', reason: 'Delivery package item count mismatch', package: pkg };
  for (const expectedItem of expected.artifacts) {
    const item = items.find(x => x.role === expectedItem.role && x.object_key === expectedItem.objectKey);
    if (!item || item.checksum !== expectedItem.checksum || item.size !== expectedItem.size || item.mime_type !== expectedItem.mimeType) {
      return { ok: false, status: 'drifted', reason: `Delivery package artifact drift: ${expectedItem.objectKey}`, package: pkg };
    }
  }

  if (pkg.status === 'created') {
    db.prepare("UPDATE production_delivery_packages SET status='verified', verified_at=? WHERE id=? AND status='created'").run(now(), pkg.id);
  }
  return { ok: true, status: 'valid', package: getPackage(projectId, pkg.id), payload, artifacts: items };
}

export function markProductionDeliveryPackageDelivered(projectId, packageId, deliveryReference, { actorId = 'system' } = {}) {
  ensureTables();
  if (!deliveryReference || !String(deliveryReference).trim()) throw new Error('Delivery reference is required');
  const verification = verifyProductionDeliveryPackage(projectId, packageId);
  if (!verification.ok) throw new Error(`Production delivery blocked: ${verification.reason}`);
  const pkg = getPackage(projectId, packageId);
  if (pkg.status === 'delivered') return pkg;
  const deliveredAt = now();
  tx(() => {
    db.prepare(`UPDATE production_delivery_packages SET status='delivered', delivered_at=?, delivery_reference=? WHERE id=? AND status IN ('created','verified')`)
      .run(deliveredAt, String(deliveryReference).trim(), packageId);
    db.prepare(`INSERT INTO audit_events
      (id, project_id, actor_id, event_type, entity_id, created_at, metadata)
      VALUES(?,?,?,?,?,?,?)`).run(
      `audit_${crypto.randomUUID()}`, projectId, actorId,
      'production.delivery-package.delivered', packageId, deliveredAt,
      JSON.stringify({ packageId, deliveryReference: String(deliveryReference).trim(), packageHash: pkg.package_hash })
    );
  });
  return getPackage(projectId, packageId);
}

export function getProductionDeliveryPackage(projectId, packageId) {
  ensureTables();
  return getPackage(projectId, packageId);
}

export function listProductionDeliveryPackages(projectId) {
  ensureTables();
  return db.prepare('SELECT * FROM production_delivery_packages WHERE project_id=? ORDER BY created_at DESC').all(projectId);
}
