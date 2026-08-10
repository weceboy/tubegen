import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  createProject, updateProject, createResearch, createScriptVersion, approveArtifact,
  applyRiskOverride, createGenerationAttempt, createVisual, createVisualVersion,
  selectVisual, rejectVisual, createSceneAsset, completeGenerationAttempt,
  assignAssetToVisual, createProductionSnapshot
} from './domain.js';
import {
  createNarrationSnapshot, createVoiceoverVersion, createTimestampVersion,
  updateTimestampMapping, getTimestampDetails
} from './production-stages.js';
import { createSceneVersion } from './pipeline.js';
import { buildTimeline, buildRoughCut, buildFineCut, finalRenderGate, requestFinalRender } from './edit-stages.js';
import { listProductionRenderJobs, getProductionRenderJob } from './production-render-jobs.js';
import { verifyProductionPublishGate } from './production-publish-gate.js';
import { publishProductionRender } from './production-publish-service.js';
import { createProductionRelease, revokeProductionRelease, verifyProductionRelease } from './production-release-service.js';
import {
  listProductionPublishes, getProductionPublish, verifyProductionPublish,
  listProductionReleases, getProductionRelease, getProductionDeliveryStatus
} from './production-delivery-service.js';
import {
  createProductionDeliveryManifest, verifyProductionDeliveryManifest, listProductionDeliveryManifests
} from './production-delivery-manifest-service.js';
import {
  createProductionDeliveryPackage, verifyProductionDeliveryPackage,
  markProductionDeliveryPackageDelivered, listProductionDeliveryPackages
} from './production-delivery-package-service.js';
import {
  createProductionDeliveryBundle, verifyProductionDeliveryBundle,
  exportProductionDeliveryBundle, listProductionDeliveryBundles
} from './production-delivery-bundle-service.js';
import { db } from './db.js';
import { assertApprovalPolicy, resolveRiskPolicy, upsertRiskPolicy } from './risk-policy.js';
import { authenticate, authorize, actorInput, securityHeaders } from './auth.js';

const PORT = Number(process.env.PORT || 8080);
const root = path.resolve(process.cwd());
const publicRoot = root;

function send(res, status, payload, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(payload));
}

function error(res, err, origin = '') {
  const status = Number(err.status) || (/required|requires|missing|duplicate|not found|Invalid|Unsupported|forbidden|block|overlap|license|current|approved|stale|policy/i.test(err.message) ? 400 : 500);
  const safe = status >= 500 ? 'Internal server error' : err.message;
  send(res, status, { error: safe, code: err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST') }, securityHeaders(origin));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (Buffer.byteLength(raw) > Number(process.env.AUTODOC_MAX_BODY_BYTES || 2_000_000)) throw Object.assign(new Error('Request body too large'), { status: 413, code: 'BODY_TOO_LARGE' });
  return JSON.parse(raw);
}

function projectDetails(id) {
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  if (!project) return null;
  return {
    project,
    research: db.prepare('SELECT * FROM research_artifacts WHERE project_id=? ORDER BY version_number DESC').all(id),
    scripts: db.prepare(`SELECT sv.* FROM script_versions sv JOIN script_artifacts sa ON sa.id=sv.script_artifact_id WHERE sa.project_id=? ORDER BY sv.version_number DESC`).all(id),
    scenes: db.prepare(`SELECT s.*, sv.id version_id, sv.version_number, sv.source_script_version_id, sv.narration_source, sv.narration_text, sv.planned_duration_ms, sv.image_prompt, sv.motion_prompt, sv.status FROM scenes s LEFT JOIN scene_versions sv ON sv.scene_id=s.id AND sv.version_number=(SELECT MAX(x.version_number) FROM scene_versions x WHERE x.scene_id=s.id) WHERE s.project_id=? ORDER BY s.scene_number`).all(id),
    voiceovers: db.prepare('SELECT * FROM voiceovers WHERE project_id=? ORDER BY version_number DESC').all(id),
    timestamps: db.prepare('SELECT * FROM timestamps WHERE project_id=? ORDER BY version_number DESC').all(id),
    visuals: db.prepare(`SELECT v.*, vv.id version_id, vv.version_number, vv.source_scene_version_id, vv.source_prompt, vv.source_asset_id, vv.status version_status FROM scene_visuals v LEFT JOIN scene_visual_versions vv ON vv.scene_visual_id=v.id AND vv.version_number=(SELECT MAX(x.version_number) FROM scene_visual_versions x WHERE x.scene_visual_id=v.id) WHERE v.project_id=? ORDER BY v.created_at`).all(id),
    assets: db.prepare(`SELECT a.*, l.license_status, l.license_type, l.license_url, l.commercial_use, l.attribution_required FROM scene_assets a LEFT JOIN asset_licenses l ON l.asset_id=a.id WHERE a.project_id=? ORDER BY a.created_at DESC`).all(id),
    timelines: db.prepare('SELECT * FROM timelines WHERE project_id=? ORDER BY version_number DESC').all(id),
    roughCuts: db.prepare('SELECT * FROM rough_cuts WHERE project_id=? ORDER BY version_number DESC').all(id),
    fineCuts: db.prepare('SELECT * FROM fine_cuts WHERE project_id=? ORDER BY version_number DESC').all(id),
    jobs: db.prepare('SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 100').all(id),
    audit: db.prepare('SELECT * FROM audit_events WHERE project_id=? ORDER BY created_at DESC LIMIT 100').all(id)
  };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') return send(res, 204, {}, securityHeaders(origin));
  try {
    const identity = authenticate(req);
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'autodoc', time: new Date().toISOString() }, securityHeaders(origin));

    if (url.pathname === '/api/projects' && req.method === 'GET') {
      authorize(identity, { roles: ['admin', 'editor', 'approver', 'viewer', 'worker'] });
      const rows = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
      const projects = identity.projects.includes('*') ? rows : rows.filter(p => identity.projects.includes(p.id));
      return send(res, 200, projects, securityHeaders(origin));
    }
    if (url.pathname === '/api/projects' && req.method === 'POST') {
      authorize(identity, { roles: ['admin'] });
      return send(res, 201, createProject(actorInput(identity, await body(req))), securityHeaders(origin));
    }

    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch && req.method === 'GET') {
      authorize(identity, { projectId: projectMatch[1] });
      const details = projectDetails(projectMatch[1]);
      if (!details) return send(res, 404, { error: 'Project not found', code: 'NOT_FOUND' }, securityHeaders(origin));
      return send(res, 200, details, securityHeaders(origin));
    }
    if (projectMatch && req.method === 'PATCH') {
      authorize(identity, { projectId: projectMatch[1], roles: ['admin', 'editor'] });
      return send(res, 200, updateProject(projectMatch[1], await body(req)), securityHeaders(origin));
    }

    const researchMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/research$/);
    if (researchMatch && req.method === 'POST') { authorize(identity, { projectId: researchMatch[1], roles: ['admin', 'editor'] }); return send(res, 201, createResearch(researchMatch[1], actorInput(identity, await body(req))), securityHeaders(origin)); }
    const scriptMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/scripts$/);
    if (scriptMatch && req.method === 'POST') { authorize(identity, { projectId: scriptMatch[1], roles: ['admin', 'editor'] }); const input = await body(req); return send(res, 201, createScriptVersion(scriptMatch[1], input.content, identity.actorId), securityHeaders(origin)); }
    const sceneMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/scenes$/);
    if (sceneMatch && req.method === 'POST') { authorize(identity, { projectId: sceneMatch[1], roles: ['admin', 'editor'] }); const input = await body(req); return send(res, 201, createSceneVersion(sceneMatch[1], input, identity.actorId), securityHeaders(origin)); }
    const narrationMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/narration-snapshots$/);
    if (narrationMatch && req.method === 'POST') { authorize(identity, { projectId: narrationMatch[1], roles: ['admin', 'editor'] }); return send(res, 201, createNarrationSnapshot(narrationMatch[1]), securityHeaders(origin)); }
    const voiceMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/voiceovers$/);
    if (voiceMatch && req.method === 'POST') { authorize(identity, { projectId: voiceMatch[1], roles: ['admin', 'editor', 'worker'] }); return send(res, 201, createVoiceoverVersion(narrationMatch?.[1] || voiceMatch[1], actorInput(identity, await body(req))), securityHeaders(origin)); }
    const timestampMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/timestamps$/);
    if (timestampMatch && req.method === 'POST') { authorize(identity, { projectId: timestampMatch[1], roles: ['admin', 'editor', 'worker'] }); return send(res, 201, createTimestampVersion(timestampMatch[1], actorInput(identity, await body(req))), securityHeaders(origin)); }
    const timestampDetailsMatch = url.pathname.match(/^\/api\/timestamps\/([^/]+)$/);
    if (timestampDetailsMatch && req.method === 'GET') { const details = getTimestampDetails(timestampDetailsMatch[1]); if (!details) return send(res, 404, { error: 'Timestamp artifact not found', code: 'NOT_FOUND' }, securityHeaders(origin)); authorize(identity, { projectId: details.project?.project_id || details.projectId }); return send(res, 200, details, securityHeaders(origin)); }
    const mappingMatch = url.pathname.match(/^\/api\/timestamps\/([^/]+)\/mappings\/([^/]+)$/);
    if (mappingMatch && req.method === 'PATCH') { const input = await body(req); return send(res, 200, updateTimestampMapping(mappingMatch[1], mappingMatch[2], actorInput(identity, input)), securityHeaders(origin)); }

    const approveMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/approve$/);
    if (approveMatch && req.method === 'POST') { authorize(identity, { projectId: approveMatch[1], roles: ['admin', 'approver'] }); const input = await body(req); assertApprovalPolicy({ projectId: approveMatch[1], artifactVersionId: input.artifactVersionId, approvalMode: input.approvalMode || 'human' }); return send(res, 200, approveArtifact({ projectId: approveMatch[1], ...input, actorId: identity.actorId }), securityHeaders(origin)); }
    const overrideMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/risk-overrides$/);
    if (overrideMatch && req.method === 'POST') { authorize(identity, { projectId: overrideMatch[1], roles: ['admin', 'approver'] }); return send(res, 201, applyRiskOverride({ projectId: overrideMatch[1], ...(await body(req)), actorId: identity.actorId }), securityHeaders(origin)); }
    const riskPolicyMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/risk-policy$/);
    if (riskPolicyMatch && req.method === 'GET') { authorize(identity, { projectId: riskPolicyMatch[1] }); return send(res, 200, resolveRiskPolicy({ projectId: riskPolicyMatch[1] }), securityHeaders(origin)); }
    if (riskPolicyMatch && req.method === 'PUT') { authorize(identity, { projectId: riskPolicyMatch[1], roles: ['admin'] }); return send(res, 200, upsertRiskPolicy({ scopeType: 'project', scopeId: riskPolicyMatch[1], ...(await body(req)), actorId: identity.actorId }), securityHeaders(origin)); }

    const visualCreate = url.pathname.match(/^\/api\/projects\/([^/]+)\/visuals$/);
    if (visualCreate && req.method === 'POST') { authorize(identity, { projectId: visualCreate[1], roles: ['admin', 'editor', 'worker'] }); return send(res, 201, createVisual({ projectId: visualCreate[1], ...(await body(req)), createdBy: identity.actorId }), securityHeaders(origin)); }
    const visualVersion = url.pathname.match(/^\/api\/projects\/([^/]+)\/visuals\/([^/]+)\/versions$/);
    if (visualVersion && req.method === 'POST') { authorize(identity, { projectId: visualVersion[1], roles: ['admin', 'editor', 'worker'] }); return send(res, 201, createVisualVersion({ projectId: visualVersion[1], visualId: visualVersion[2], ...(await body(req)), createdBy: identity.actorId }), securityHeaders(origin)); }
    const visualSelect = url.pathname.match(/^\/api\/projects\/([^/]+)\/visuals\/([^/]+)\/select$/);
    if (visualSelect && req.method === 'POST') { authorize(identity, { projectId: visualSelect[1], roles: ['admin', 'editor'] }); return send(res, 200, selectVisual({ projectId: visualSelect[1], visualId: visualSelect[2], ...(await body(req)), actorId: identity.actorId }), securityHeaders(origin)); }
    const visualReject = url.pathname.match(/^\/api\/projects\/([^/]+)\/visuals\/([^/]+)\/reject$/);
    if (visualReject && req.method === 'POST') { authorize(identity, { projectId: visualReject[1], roles: ['admin', 'editor'] }); return send(res, 200, rejectVisual({ projectId: visualReject[1], visualId: visualReject[2], ...(await body(req)), actorId: identity.actorId }), securityHeaders(origin)); }
    const attemptMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/visual-attempts$/);
    if (attemptMatch && req.method === 'POST') { authorize(identity, { projectId: attemptMatch[1], roles: ['admin', 'editor', 'worker'] }); return send(res, 201, createGenerationAttempt({ projectId: attemptMatch[1], ...(await body(req)) }), securityHeaders(origin)); }
    const completeAttempt = url.pathname.match(/^\/api\/projects\/([^/]+)\/visual-attempts\/([^/]+)\/complete$/);
    if (completeAttempt && req.method === 'POST') { authorize(identity, { projectId: completeAttempt[1], roles: ['admin', 'worker'] }); return send(res, 200, completeGenerationAttempt({ projectId: completeAttempt[1], attemptId: completeAttempt[2], ...(await body(req)) }), securityHeaders(origin)); }
    const assetCreate = url.pathname.match(/^\/api\/projects\/([^/]+)\/assets$/);
    if (assetCreate && req.method === 'POST') { authorize(identity, { projectId: assetCreate[1], roles: ['admin', 'editor', 'worker'] }); return send(res, 201, createSceneAsset({ projectId: assetCreate[1], ...(await body(req)) }), securityHeaders(origin)); }
    const assetAssign = url.pathname.match(/^\/api\/projects\/([^/]+)\/visual-versions\/([^/]+)\/asset$/);
    if (assetAssign && req.method === 'POST') { authorize(identity, { projectId: assetAssign[1], roles: ['admin', 'editor', 'worker'] }); return send(res, 200, assignAssetToVisual({ projectId: assetAssign[1], visualVersionId: assetAssign[2], ...(await body(req)), actorId: identity.actorId }), securityHeaders(origin)); }

    const timelineBuild = url.pathname.match(/^\/api\/projects\/([^/]+)\/timeline$/);
    if (timelineBuild && req.method === 'POST') { authorize(identity, { projectId: timelineBuild[1], roles: ['admin', 'editor', 'worker'] }); return send(res, 201, buildTimeline(timelineBuild[1], actorInput(identity, await body(req))), securityHeaders(origin)); }
    const timelineGate = url.pathname.match(/^\/api\/projects\/([^/]+)\/timeline\/gate$/);
    if (timelineGate && req.method === 'GET') { authorize(identity, { projectId: timelineGate[1] }); return send(res, 200, buildTimeline(timelineGate[1], { actorId: identity.actorId }), securityHeaders(origin)); }
    const roughBuild = url.pathname.match(/^\/api\/projects\/([^/]+)\/rough-cuts$/);
    if (roughBuild && req.method === 'POST') { authorize(identity, { projectId: roughBuild[1], roles: ['admin', 'editor', 'worker'] }); return send(res, 201, buildRoughCut(roughBuild[1], actorInput(identity, await body(req))), securityHeaders(origin)); }
    const fineBuild = url.pathname.match(/^\/api\/projects\/([^/]+)\/fine-cuts$/);
    if (fineBuild && req.method === 'POST') { authorize(identity, { projectId: fineBuild[1], roles: ['admin', 'editor', 'worker'] }); return send(res, 201, buildFineCut(fineBuild[1], actorInput(identity, await body(req))), securityHeaders(origin)); }
    const renderGate = url.pathname.match(/^\/api\/projects\/([^/]+)\/render-gate$/);
    if (renderGate && req.method === 'GET') { authorize(identity, { projectId: renderGate[1] }); return send(res, 200, finalRenderGate(renderGate[1]), securityHeaders(origin)); }
    const renderRequest = url.pathname.match(/^\/api\/projects\/([^/]+)\/render$/);
    if (renderRequest && req.method === 'POST') { authorize(identity, { projectId: renderRequest[1], roles: ['admin', 'worker'] }); return send(res, 202, requestFinalRender(renderRequest[1], actorInput(identity, await body(req))), securityHeaders(origin)); }
    const snapshotMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/snapshot$/);
    if (snapshotMatch && req.method === 'GET') { authorize(identity, { projectId: snapshotMatch[1] }); return send(res, 200, createProductionSnapshot(snapshotMatch[1]), securityHeaders(origin)); }
    const renderJobList = url.pathname.match(/^\/api\/projects\/([^/]+)\/render-jobs$/);
    if (renderJobList && req.method === 'GET') { authorize(identity, { projectId: renderJobList[1] }); return send(res, 200, listProductionRenderJobs(renderJobList[1]), securityHeaders(origin)); }
    const renderJobDetail = url.pathname.match(/^\/api\/projects\/([^/]+)\/render-jobs\/([^/]+)$/);
    if (renderJobDetail && req.method === 'GET') { authorize(identity, { projectId: renderJobDetail[1] }); const job = getProductionRenderJob(renderJobDetail[1], renderJobDetail[2]); if (!job) return send(res, 404, { error: 'Render job not found', code: 'NOT_FOUND' }, securityHeaders(origin)); return send(res, 200, job, securityHeaders(origin)); }

    const publishCreate = url.pathname.match(/^\/api\/projects\/([^/]+)\/publish$/);
    if (publishCreate && req.method === 'POST') { authorize(identity, { projectId: publishCreate[1], roles: ['admin', 'worker'] }); const input = await body(req); return send(res, 201, publishProductionRender(publishCreate[1], input.jobId, { actorId: identity.actorId }), securityHeaders(origin)); }
    const publishGate = url.pathname.match(/^\/api\/projects\/([^/]+)\/publish-gate\/([^/]+)$/);
    if (publishGate && req.method === 'GET') { authorize(identity, { projectId: publishGate[1] }); return send(res, 200, verifyProductionPublishGate(publishGate[1], publishGate[2]), securityHeaders(origin)); }
    const publishList = url.pathname.match(/^\/api\/projects\/([^/]+)\/publishes$/);
    if (publishList && req.method === 'GET') { authorize(identity, { projectId: publishList[1] }); return send(res, 200, listProductionPublishes(publishList[1]), securityHeaders(origin)); }
    const publishDetail = url.pathname.match(/^\/api\/projects\/([^/]+)\/publishes\/([^/]+)$/);
    if (publishDetail && req.method === 'GET') { authorize(identity, { projectId: publishDetail[1] }); const publish = getProductionPublish(publishDetail[1], publishDetail[2]); if (!publish) return send(res, 404, { error: 'Publish not found', code: 'NOT_FOUND' }, securityHeaders(origin)); return send(res, 200, { publish, verification: verifyProductionPublish(publishDetail[1], publishDetail[2]) }, securityHeaders(origin)); }

    const releaseCollection = url.pathname.match(/^\/api\/projects\/([^/]+)\/releases$/);
    if (releaseCollection && req.method === 'POST') { authorize(identity, { projectId: releaseCollection[1], roles: ['admin'] }); const input = await body(req); return send(res, 201, createProductionRelease(releaseCollection[1], input.renderJobId, { actorId: identity.actorId }), securityHeaders(origin)); }
    if (releaseCollection && req.method === 'GET') { authorize(identity, { projectId: releaseCollection[1] }); return send(res, 200, listProductionReleases(releaseCollection[1]), securityHeaders(origin)); }
    const releaseRevoke = url.pathname.match(/^\/api\/projects\/([^/]+)\/releases\/([^/]+)\/revoke$/);
    if (releaseRevoke && req.method === 'POST') { authorize(identity, { projectId: releaseRevoke[1], roles: ['admin'] }); const input = await body(req); return send(res, 200, revokeProductionRelease(releaseRevoke[1], releaseRevoke[2], input.reason, { actorId: identity.actorId }), securityHeaders(origin)); }
    const releaseDetail = url.pathname.match(/^\/api\/projects\/([^/]+)\/releases\/([^/]+)$/);
    if (releaseDetail && req.method === 'GET') { authorize(identity, { projectId: releaseDetail[1] }); const release = getProductionRelease(releaseDetail[1], releaseDetail[2]); if (!release) return send(res, 404, { error: 'Release not found', code: 'NOT_FOUND' }, securityHeaders(origin)); return send(res, 200, { release, verification: verifyProductionRelease(releaseDetail[1], releaseDetail[2]) }, securityHeaders(origin)); }

    const deliveryStatus = url.pathname.match(/^\/api\/projects\/([^/]+)\/delivery-status$/);
    if (deliveryStatus && req.method === 'GET') { authorize(identity, { projectId: deliveryStatus[1] }); return send(res, 200, getProductionDeliveryStatus(deliveryStatus[1]), securityHeaders(origin)); }

    const manifestCreate = url.pathname.match(/^\/api\/projects\/([^/]+)\/releases\/([^/]+)\/delivery-manifest$/);
    if (manifestCreate && req.method === 'POST') { authorize(identity, { projectId: manifestCreate[1], roles: ['admin'] }); return send(res, 201, createProductionDeliveryManifest(manifestCreate[1], manifestCreate[2], { actorId: identity.actorId }), securityHeaders(origin)); }
    const manifestList = url.pathname.match(/^\/api\/projects\/([^/]+)\/delivery-manifests$/);
    if (manifestList && req.method === 'GET') { authorize(identity, { projectId: manifestList[1] }); return send(res, 200, listProductionDeliveryManifests(manifestList[1]), securityHeaders(origin)); }
    const manifestDetail = url.pathname.match(/^\/api\/projects\/([^/]+)\/delivery-manifests\/([^/]+)$/);
    if (manifestDetail && req.method === 'GET') { authorize(identity, { projectId: manifestDetail[1] }); return send(res, 200, verifyProductionDeliveryManifest(manifestDetail[1], manifestDetail[2]), securityHeaders(origin)); }

    const packageCreate = url.pathname.match(/^\/api\/projects\/([^/]+)\/releases\/([^/]+)\/delivery-package$/);
    if (packageCreate && req.method === 'POST') { authorize(identity, { projectId: packageCreate[1], roles: ['admin'] }); return send(res, 201, createProductionDeliveryPackage(packageCreate[1], packageCreate[2], { actorId: identity.actorId }), securityHeaders(origin)); }
    const packageList = url.pathname.match(/^\/api\/projects\/([^/]+)\/delivery-packages$/);
    if (packageList && req.method === 'GET') { authorize(identity, { projectId: packageList[1] }); return send(res, 200, listProductionDeliveryPackages(packageList[1]), securityHeaders(origin)); }
    const packageDetail = url.pathname.match(/^\/api\/projects\/([^/]+)\/delivery-packages\/([^/]+)$/);
    if (packageDetail && req.method === 'GET') { authorize(identity, { projectId: packageDetail[1] }); return send(res, 200, verifyProductionDeliveryPackage(packageDetail[1], packageDetail[2]), securityHeaders(origin)); }
    const packageDeliver = url.pathname.match(/^\/api\/projects\/([^/]+)\/delivery-packages\/([^/]+)\/deliver$/);
    if (packageDeliver && req.method === 'POST') { authorize(identity, { projectId: packageDeliver[1], roles: ['admin'] }); const input = await body(req); return send(res, 200, markProductionDeliveryPackageDelivered(packageDeliver[1], packageDeliver[2], input.deliveryReference, { actorId: identity.actorId }), securityHeaders(origin)); }

    const bundleCreate = url.pathname.match(/^\/api\/projects\/([^/]+)\/releases\/([^/]+)\/delivery-bundle$/);
    if (bundleCreate && req.method === 'POST') { authorize(identity, { projectId: bundleCreate[1], roles: ['admin'] }); return send(res, 201, createProductionDeliveryBundle(bundleCreate[1], bundleCreate[2], { actorId: identity.actorId }), securityHeaders(origin)); }
    const bundleList = url.pathname.match(/^\/api\/projects\/([^/]+)\/delivery-bundles$/);
    if (bundleList && req.method === 'GET') { authorize(identity, { projectId: bundleList[1] }); return send(res, 200, listProductionDeliveryBundles(bundleList[1]), securityHeaders(origin)); }
    const bundleDetail = url.pathname.match(/^\/api\/projects\/([^/]+)\/delivery-bundles\/([^/]+)$/);
    if (bundleDetail && req.method === 'GET') { authorize(identity, { projectId: bundleDetail[1] }); return send(res, 200, verifyProductionDeliveryBundle(bundleDetail[1], bundleDetail[2]), securityHeaders(origin)); }
    const bundleExport = url.pathname.match(/^\/api\/projects\/([^/]+)\/delivery-bundles\/([^/]+)\/export$/);
    if (bundleExport && req.method === 'POST') { authorize(identity, { projectId: bundleExport[1], roles: ['admin'] }); const input = await body(req); return send(res, 200, exportProductionDeliveryBundle(bundleExport[1], bundleExport[2], input.exportReference, { actorId: identity.actorId }), securityHeaders(origin)); }

    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'API route not found', code: 'NOT_FOUND' }, securityHeaders(origin));
    return serveStatic(url.pathname, res);
  } catch (err) {
    console.error(err);
    return error(res, err, origin);
  }
}

function serveStatic(requestPath, res) {
  let filePath = path.join(publicRoot, requestPath === '/' ? 'index.html' : requestPath);
  if (!filePath.startsWith(publicRoot)) return send(res, 403, { error: 'Forbidden', code: 'FORBIDDEN' });
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(publicRoot, 'index.html');
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

http.createServer(route).listen(PORT, () => console.log(`AutoDoc running on http://localhost:${PORT}`));
