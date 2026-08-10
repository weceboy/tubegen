import { evaluateProductionReadiness } from './production-readiness.js';
import { inspectProductionSnapshot } from './production-snapshot.js';

/**
 * Final render gate (legacy string-error shape).
 *
 * Not called from server/index.js (see edit-stages.js:finalRenderGate for
 * the live equivalent) and has no other importer left in the codebase.
 * Kept only so render-service.js (also unreferenced) still resolves.
 *
 * This used to duplicate the full Research..Fine-Cut check inline. It now
 * delegates to the shared `evaluateProductionReadiness()` (Research..Fine
 * Cut approval/staleness) plus `inspectProductionSnapshot()` (per-scene
 * visual/asset/license lineage), so there is exactly one implementation of
 * each check instead of four slightly different copies scattered across
 * production-gate.js, render-gate.js, production-snapshot.js and (formerly)
 * edit-stages.js.
 */
export function checkFinalRenderGate(projectId) {
  const readiness = evaluateProductionReadiness(projectId);
  const snapshot = inspectProductionSnapshot(projectId);
  const errors = [...readiness.errors.map((e) => e.message), ...snapshot.errors.map((e) => e.message)];
  return { allowed: errors.length === 0, errors };
}
