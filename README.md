# AutoDoc

Production workspace for automated video production.

## Product model

AutoDoc is organized around **Projects → Stages → Artifacts → Review → Next stage**. A project is a production folder containing the structured outputs needed to make a finished video.

```text
Idea / Research → Research artifact
        ↓
Approved Script → independently versioned Scenes
        ↓
Narration Snapshot → Voiceover
        ↓
Timestamp mapping → SRT / JSON
        ↓
Scene Visual Entities → Visual Versions → Assets
        ↓
Timeline → Rough Cut → Fine Cut → Final Render
```

Every production result is a versioned, traceable artifact with explicit input lineage, approval state and audit history.

## Implemented foundation

- SQLite persistence with foreign keys and WAL mode
- Stable entities + independent versions for Research, Script, Scenes and Visuals
- Narration snapshots for exact Voiceover lineage
- Scene Visual → Visual Version → Generation Attempt → Asset chain
- `generation_index` separated from idempotency, so explicit Regenerate creates a new attempt
- Asset-level licensing records and render-time license verification data
- Risk reports and explicit Risk Override records
- Risk Override never approves an artifact; subsequent approval must be human
- Approval audit attribution and linked override IDs
- Automatic Research `change_type` classification with audited content→metadata downgrade
- Conservative stale propagation for content Research changes
- Production snapshot support down to concrete generation attempt and asset
- Durable jobs, provider adapters and worker reconciliation
- Token authentication with actor/role identity and project-scoped authorization
- Fail-closed production authentication, explicit CORS allow-listing and bounded request bodies
- Automated v3.3, worker, provider and UI contract tests

## Production workflow UI

The live workspace now exposes the complete production path as one control surface:

**Research → Script → Scenes → Voiceover → Timestamps → Visuals → Edit & Render**

Each stage reads persisted project state and exposes the corresponding API mutation. The UI keeps approval, selection and license gates visible rather than treating them as one generic "ready" flag. Visuals remain traceable through entity → version → attempt → asset, and final rendering checks the render gate before submitting a render request. The Edit & Render stage also covers publish → release → delivery manifest → package → bundle → export, each gated on the previous step (see "API foundation" below for the caveat that rendering itself is mocked until a real renderer is wired in).

The existing Visual Candidate Studio remains available for v3.3 entity/version/attempt interactions.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:8080`.

`npm start` only runs the HTTP API. Nothing processes queued jobs unless a
worker is also running. Start both workers alongside it:

```bash
npm run worker          # visual generation (generic jobs queue)
npm run worker:render   # production render jobs
```

For development:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

The local database is created automatically at `data/autodoc.sqlite` (or the path configured by `AUTODOC_DB`). Copy `.env.example` to `.env` for local configuration. Production secrets must be stored in a proper secret manager, never committed to the repository.

## API authentication

Production API access is fail-closed. Configure `AUTODOC_AUTH_TOKENS` as a JSON object mapping opaque tokens to an actor, role and project scope:

```json
{
  "replace-with-secret": {
    "actorId": "editor-1",
    "role": "editor",
    "projects": ["project-id"]
  }
}
```

Send the token as either `Authorization: Bearer <token>` or `X-AutoDoc-Token: <token>`. Supported roles are `admin`, `editor`, `approver`, `worker` and `viewer`. Project-scoped identities cannot read or mutate another project. Approval and risk-override endpoints require `admin` or `approver`; project risk-policy changes require `admin`.

For browser clients, set `AUTODOC_ALLOWED_ORIGINS` to a comma-separated explicit origin allow-list. Do not use `*` in production.

## API foundation

```text
GET  /api/health
GET  /api/projects
POST /api/projects
GET  /api/projects/:id
POST /api/projects/:id/research
POST /api/projects/:id/scripts
POST /api/projects/:id/scenes
POST /api/projects/:id/approve
POST /api/projects/:id/risk-overrides
POST /api/projects/:id/visual-attempts
GET  /api/projects/:id/render-gate (readiness gate)
POST /api/projects/:id/render      (request a render; creates a persisted
                                     production snapshot and enqueues a
                                     production_render_jobs entry)
GET  /api/projects/:id/snapshot
GET  /api/projects/:id/render-jobs
GET  /api/projects/:id/render-jobs/:jobId

POST /api/projects/:id/publish                          { jobId }
GET  /api/projects/:id/publish-gate/:jobId               (readiness gate)
GET  /api/projects/:id/publishes
GET  /api/projects/:id/publishes/:publishId

POST /api/projects/:id/releases                          { renderJobId }
GET  /api/projects/:id/releases
GET  /api/projects/:id/releases/:releaseId
POST /api/projects/:id/releases/:releaseId/revoke         { reason }

GET  /api/projects/:id/delivery-status

POST /api/projects/:id/releases/:releaseId/delivery-manifest
GET  /api/projects/:id/delivery-manifests
GET  /api/projects/:id/delivery-manifests/:manifestId

POST /api/projects/:id/releases/:releaseId/delivery-package
GET  /api/projects/:id/delivery-packages
GET  /api/projects/:id/delivery-packages/:packageId
POST /api/projects/:id/delivery-packages/:packageId/deliver { deliveryReference }

POST /api/projects/:id/releases/:releaseId/delivery-bundle
GET  /api/projects/:id/delivery-bundles
GET  /api/projects/:id/delivery-bundles/:bundleId
POST /api/projects/:id/delivery-bundles/:bundleId/export  { exportReference }
```

Publish, release and delivery each follow the same shape as the rest of the
API: `POST` creates or mutates and is idempotent per its natural key, `GET`
on a single record returns a `verify*`-style `{ ok, status, reason, ... }`
body instead of throwing (mirroring `render-gate`), and list endpoints
return arrays newest-first. Release channel promotion/rollback
(`production-release-promotion.js`) is implemented but intentionally left
unwired - it's a separate feature from the create/publish/release/deliver
mainline.

The Edit & Render stage's live workspace now also covers this chain: pick a
completed render job to publish, create a release, then step through
delivery manifest -> package -> mark delivered -> bundle -> export, each
gated on the previous step exactly like the API.

**No renderer is wired in by default.** `npm run worker:render` runs
`processProductionRenderJob()` against a `mockProductionRenderer`
(`production-render-jobs.js`), which fabricates a checksum and object key
rather than producing an actual video file. The full pipeline - including
publish/release/delivery - can be exercised end to end today, but the
"finished video" at the end of it is a database record, not a real
render, until a real renderer (e.g. Remotion) is passed in. See "Next
build stages".

## Next build stages

1. Real provider credentials and production secret storage.
2. ElevenLabs/Whisper integrations and timestamp editing/approval.
3. Image/stock providers and object storage delivery.
4. A real renderer wired into `processProductionRenderJob()` (Remotion or
   similar) - currently defaults to a mock that fabricates output metadata
   without producing an actual video file.
5. GDPR/compliance controls and operational observability.
6. Release channel promotion/rollback HTTP routes and UI, if the channel-promotion feature is kept.
