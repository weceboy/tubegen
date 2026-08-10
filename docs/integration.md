# TubeGen Integration Audit

Date: 2026-08-10
Repository: `weceboy/tubegen`
Branch: `integration/audit`

## Executive summary

The repository currently contains a backend foundation, not an integrated frontend/backend TubeGen application.

The backend has a coherent initial architecture around Fastify, Prisma/PostgreSQL, a persisted job table, a worker loop, a centralized project state machine, and mock LLM/research provider interfaces. The README and architecture documentation explicitly describe this as the backend foundation. There is no frontend application, frontend package manifest, frontend API client, UI state layer, or frontend pipeline implementation in the repository at the audited revision.

Therefore the requested end-to-end flow cannot currently be executed from a browser. The highest-priority integration work is to preserve the backend domain as the source of truth while adding the missing API/domain workflow endpoints and then connecting a frontend to those contracts.

## Audit scope

Audited areas:

- repository metadata and recent commit history
- README and development documentation
- Prisma schema and database documentation
- Fastify application/bootstrap
- project and channel routes
- job routes and job service
- pipeline state machine
- worker and job executor
- mock LLM/research providers
- environment configuration
- PostgreSQL Docker Compose
- development seed
- existing test/provider foundation
- CI/workflow signal available from GitHub

## Repository state

### Frontend

**Status: MISSING**

No React/Vite/Next frontend package, `src` frontend tree, browser entrypoint, API client, TanStack Query configuration, components, dashboard, project workspace, pipeline UI, or frontend tests were found in the audited repository.

This is the primary integration blocker. The requested Dashboard -> New Project -> production pipeline cannot currently be driven by a user through a browser.

### Backend

**Status: PARTIAL FOUNDATION**

The backend currently provides:

- Fastify application bootstrap
- `/health`, `/health/db`, `/health/workers`
- channel CRUD
- project CRUD
- project status transition endpoint
- project job listing
- generic job enqueue endpoint
- job cancellation
- Prisma/PostgreSQL integration
- persisted job claiming and retry handling
- worker polling/execution
- mock LLM and research provider interfaces
- centralized project status transitions
- basic structured error handling

The backend architecture documents the boundaries as API -> services -> domain -> Prisma/PostgreSQL and Job API -> Job table -> worker -> provider -> persisted result.

### Database / Prisma

**Status: STRONG FOUNDATION**

`prisma/schema.prisma` contains the requested domain foundations, including:

- `ProjectStatus`
- `StageStatus`
- `JobStatus`
- `JobType`
- projects/channels/users
- research and sources
- content briefs
- versioned scripts
- scenes and scene versions
- generation attempts and assets
- voiceovers and timestamp segments
- timelines and renders
- thumbnails and metadata
- approvals
- publications
- jobs
- cost events

The database documentation explicitly establishes PostgreSQL as the system of record and object storage as the location for media binaries.

### Workers

**Status: PARTIAL**

A database-backed polling worker exists. `JobExecutor` supports registered handlers and persists success/failure/retry state.

However, the current worker registers a generic mock handler for every `JobType`. Only `GENERATE_SCRIPT` invokes the mock LLM provider explicitly. Research, scenes, visuals, voiceover, transcription, timeline, render, QA and YouTube upload do not yet implement their requested domain workflows.

### Providers

**Status: PARTIAL**

Provider interfaces currently exist for LLM and research. Mock implementations exist and are deterministic enough for unit tests.

There are not yet equivalent production/mock interfaces wired through the full media pipeline for image, video, voice, transcription, storage, rendering and YouTube publication.

### Docker / local runtime

**Status: PARTIAL**

Docker Compose currently starts PostgreSQL only. It does not start the backend, frontend, or worker. The documented `docker compose up` acceptance flow therefore cannot currently result in a complete TubeGen application.

### Environment

**Status: PARTIAL**

The current environment configuration covers `NODE_ENV`, host/port, database URL, log level and worker polling interval. It does not yet expose the requested mock-provider, storage, provider, YouTube, API URL, or frontend configuration.

## Current API inventory

### Existing

| Endpoint | Current state |
|---|---|
| `GET /health` | Exists |
| `GET /health/db` | Exists |
| `GET /health/workers` | Exists |
| `GET /channels` | Exists |
| `POST /channels` | Exists |
| `GET /channels/:id` | Exists |
| `PATCH /channels/:id` | Exists |
| `DELETE /channels/:id` | Exists |
| `GET /projects` | Exists |
| `POST /projects` | Exists |
| `GET /projects/:id` | Exists |
| `PATCH /projects/:id` | Exists |
| `DELETE /projects/:id` | Exists |
| `POST /projects/:id/transition` | Exists |
| `GET /projects/:id/jobs` | Exists |
| `POST /projects/:id/jobs` | Exists |
| `POST /jobs/:id/cancel` | Exists |

### Missing for the requested production flow

- `POST /projects/:id/research`
- `GET /projects/:id/research`
- `POST /projects/:id/brief`
- `POST /projects/:id/script`
- `GET /projects/:id/scripts`
- `POST /projects/:id/scenes`
- `GET /projects/:id/scenes`
- `POST /projects/:id/voiceover`
- `POST /projects/:id/visuals`
- `GET /projects/:id/jobs/:jobId`
- `GET /projects/:id/artifacts`
- `GET /projects/:id/approvals`
- `POST /approvals/:id/approve`
- `POST /approvals/:id/reject`
- `POST /projects/:id/timeline`
- `POST /projects/:id/render`
- `POST /projects/:id/publish`

The current API also lacks a dedicated final-approval/publish business rule implementation.

## Contract mismatches

### Response envelope

The target integration contract requires all successful responses to use `{ data: ... }` and job creation to use `{ data: { jobId, projectId, status } }`.

Most current routes follow `{ data: ... }`, but `POST /projects/:id/jobs` currently returns `{ projectId, jobId, status }` without the `data` wrapper. Health endpoints also intentionally use their own response shape. The API contract must be normalized and documented rather than forcing frontend-specific handling per endpoint.

### List metadata

The requested contract defines `{ data: [...], meta: { page, pageSize, total } }` for lists. Current project/channel/job list routes return only `data` and do not expose pagination metadata.

### Domain vs UI state

The Prisma domain states are suitable as the backend source of truth. The frontend must not introduce competing values such as `loading`, `done`, or `generating` as domain status. UI state should remain separate from server state.

### Job lifecycle

The backend has `QUEUED -> RUNNING -> SUCCEEDED/FAILED/CANCELLED` persistence and retry logic, but there is no job-by-ID GET endpoint for frontend monitoring and no stage-specific mutation contract that returns the job handle expected by the UI.

### Pipeline synchronization

The current project transition endpoint permits an explicit status transition, but the requested application requires stage status to be derived from persisted research/script/scene/asset/approval/render state. Business transitions must be tied to actual workflow completion rather than button clicks or arbitrary frontend state.

## Source-of-truth assessment

The Prisma/backend domain should remain authoritative. This matches the repository's own architecture and database documentation.

Recommended contract direction:

`Prisma/domain -> backend DTO -> API contract/OpenAPI -> frontend generated/shared types`

Do not expose Prisma models directly as the long-term frontend contract.

## Job system assessment

The persisted job foundation is reusable and should not be replaced.

Strengths:

- queued/running/succeeded/failed/cancelled states
- priority
- scheduled jobs
- attempt count
- retry handling
- idempotency payload support
- atomic claim guard using status
- separate worker process

Required integration work:

1. Add `GET /projects/:id/jobs/:jobId`.
2. Add stage-specific job creation endpoints that validate business prerequisites.
3. Return a consistent job envelope.
4. Persist domain artifacts/results from handlers instead of returning generic mock payloads.
5. Add progress persistence only when real provider progress exists.
6. Keep polling as the first robust frontend monitoring mechanism.
7. Add SSE/WebSocket invalidation only after the polling contract is stable.

## Pipeline gap analysis

| Stage | DB model/foundation | API | Worker/domain execution | Frontend |
|---|---|---|---|---|
| Project | Yes | Partial | N/A | Missing |
| Research | Yes | Missing | Missing | Missing |
| Brief | Yes | Missing | Missing | Missing |
| Script | Yes | Missing | Partial mock capability | Missing |
| Scenes | Yes | Missing | Missing | Missing |
| Visuals | Yes | Missing | Missing | Missing |
| Voiceover | Yes | Missing | Missing | Missing |
| Timestamps | Yes | Missing | Missing | Missing |
| Timeline | Yes | Missing | Missing | Missing |
| Render | Yes | Missing | Missing/Remotion not wired | Missing |
| Approval | Yes | Missing | Missing | Missing |
| Publish | Yes | Missing | Missing/YouTube not wired | Missing |

## Critical acceptance blockers

The following acceptance requirements cannot pass at the current revision:

1. Browser Dashboard and New Project flow.
2. Full research workflow.
3. Script version generation through the API.
4. Scene breakdown generation.
5. Visual candidate generation/selection/approval.
6. Voiceover/transcription flow.
7. Timeline construction.
8. Remotion render flow.
9. Final approval gate.
10. Mock YouTube publication.
11. Full E2E acceptance test.
12. `docker compose up` as a complete application startup.

## Security / architecture observations

- No browser-facing provider secrets are present in the current frontend because the frontend is not implemented.
- Authentication is not implemented; the current project/channel APIs accept `ownerId` directly. This is acceptable only as development scaffolding and must be replaced by authenticated identity/authorization before production.
- Project ownership/channel ownership should be validated server-side; IDs supplied by a client must not grant access to another user's project.
- Business rules such as final approval and publish prerequisites must remain backend-enforced.
- Large media should remain object-storage-backed and referenced by storage keys/URLs rather than transported as Base64 through API responses.

## Recommended integration sequence

1. Freeze and document the backend domain contract.
2. Add/complete stage-specific backend services and routes.
3. Normalize response/error envelopes.
4. Add job status-by-ID and artifact/approval queries.
5. Add mock provider interfaces for every external capability required by the E2E flow.
6. Implement deterministic mock E2E domain data for `$6 Handpowered Washer`.
7. Add OpenAPI and generate frontend types/API client where practical.
8. Add the frontend shell/dashboard/project workspace.
9. Add TanStack Query server state and mutation invalidation.
10. Add job polling with backoff.
11. Connect research -> script -> scenes -> visuals -> approvals -> timeline -> render -> publish.
12. Expand Docker Compose to run PostgreSQL/backend/worker/frontend.
13. Add the full integration and E2E acceptance tests.
14. Run typecheck/lint/tests/build and the exact acceptance flow before declaring completion.

## Audit conclusion

**Integration status: NOT INTEGRATED.**

The repository is a credible backend foundation, but the requested TubeGen application does not yet exist as an integrated frontend/backend system. The backend architecture and Prisma model provide a good base and should be preserved. The next implementation phase should focus on completing the domain/API workflow and introducing the missing frontend rather than rewriting the existing backend architecture.
