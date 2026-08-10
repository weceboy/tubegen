import { db } from './db.js';
import { verifyProductionRelease } from './production-release-service.js';
import { sha256 } from './hash.js';

function attestationHash(job) {
  return sha256({
    jobId: job.id,
    outputAssetId: job.output_asset_id,
    outputChecksum: job.output_checksum,
    outputManifestHash: job.output_manifest_hash,
    outputLineageHash: job.output_lineage_hash,
  });
}

function projectPublish(projectId, publishId) {
  return db.prepare('SELECT * FROM production_publishes WHERE id=? AND project_id=?').get(publishId, projectId);
}

export function verifyProductionPublish(projectId, publishId) {
  const publish = projectPublish(projectId, publishId);
  if (!publish) return { ok: false, status: 'missing', reason: 'Production publish not found' };

  const job = db.prepare('SELECT * FROM production_render_jobs WHERE id=? AND project_id=?').get(publish.render_job_id, projectId);
  if (!job) return { ok: false, status: 'drifted', reason: 'Render job is missing', publish };
  if (job.status !== 'completed' || !job.output_asset_id) {
    return { ok: false, status: 'drifted', reason: 'Render output is no longer complete', publish };
  }
  if (job.output_asset_id !== publish.output_asset_id) {
    return { ok: false, status: 'drifted', reason: 'Published output asset no longer matches render job', publish };
  }

  const expected = attestationHash(job);
  if (expected !== publish.attestation_hash) {
    return { ok: false, status: 'drifted', reason: 'Publish attestation hash mismatch', publish };
  }

  return { ok: true, status: 'valid', publish, job };
}

export function listProductionPublishes(projectId) {
  return db.prepare('SELECT * FROM production_publishes WHERE project_id=? ORDER BY published_at DESC').all(projectId);
}

export function getProductionPublish(projectId, publishId) {
  return projectPublish(projectId, publishId) || null;
}

export function listProductionReleases(projectId) {
  return db.prepare('SELECT * FROM production_releases WHERE project_id=? ORDER BY release_number DESC').all(projectId);
}

export function getProductionRelease(projectId, releaseId) {
  return db.prepare('SELECT * FROM production_releases WHERE id=? AND project_id=?').get(releaseId, projectId) || null;
}

export function getProductionDeliveryStatus(projectId) {
  const publishes = listProductionPublishes(projectId);
  const releases = listProductionReleases(projectId);
  const latestPublish = publishes[0] || null;
  const latestRelease = releases[0] || null;

  const publishVerification = latestPublish
    ? verifyProductionPublish(projectId, latestPublish.id)
    : { ok: false, status: 'missing', reason: 'No production publish exists' };
  const releaseVerification = latestRelease
    ? verifyProductionRelease(projectId, latestRelease.id)
    : { ok: false, status: 'missing', reason: 'No production release exists' };

  return {
    projectId,
    publish: {
      latest: latestPublish,
      verification: publishVerification,
      count: publishes.length,
    },
    release: {
      latest: latestRelease,
      verification: releaseVerification,
      count: releases.length,
    },
    ready: publishVerification.ok && releaseVerification.ok,
  };
}
