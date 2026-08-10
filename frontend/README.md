# TubeGen Frontend — Production OS

Desktop-first production cockpit for TubeGen. Backend + Prisma remain the source of truth; the frontend never accesses Prisma directly and never stores provider or YouTube credentials.

## Stack

- Next.js App Router + React + TypeScript
- TanStack Query 5 for server state and polling
- Lucide React for accessible iconography
- Vitest for frontend unit tests
- Central API boundary under `frontend/api/`, re-exported by `lib/api.ts`

## Production surfaces

- Dashboard / Projects / Project Detail
- Research / Content Brief / Script / Scenes
- Voiceover / Timestamps
- Visual Candidate Studio / Generation states
- Declarative Timeline / Motion / Captions / Render state
- QA / Approval Center / Thumbnail + Metadata + Publish gate
- Production Queue / Asset Library / Activity / Notes
- Channels / Motion Templates / Providers / Settings

## Routes

`/dashboard`, `/projects`, `/projects/new`, `/projects/:id`, `/projects/:id/research`, `/projects/:id/content-brief`, `/projects/:id/script`, `/projects/:id/scenes`, `/projects/:id/voiceover`, `/projects/:id/timestamps`, `/projects/:id/visuals`, `/projects/:id/edit`, `/projects/:id/qa`, `/projects/:id/review`, `/projects/:id/publish`, `/queue`, `/assets`, `/channels`, `/templates`, `/providers`, `/settings`.

## Server state

`frontend/api/client.ts` owns HTTP behavior. Domain modules are split into `projects.ts`, `scenes.ts`, `jobs.ts`, `assets.ts`, `approvals.ts`, and `channels.ts`. `hooks/use-production-state.ts` provides TanStack Query polling for projects, scenes and jobs. `api/jobs.ts` also exposes an SSE adapter for `job.*`, `project.stage.changed`, and `approval.*` events.

## UX rules

- Every production surface communicates **WHAT / STATUS / NEXT**.
- `PROCESSING` is never rendered as `READY` by the frontend.
- Publish is blocked until visual approval, successful render and final approval are all true.
- Reject flows require a comment in the approval UI.
- Scene/visual provenance is explicit: Scene → SceneVersion → GenerationAttempt → Asset.
- Empty, loading, processing and error states are visible rather than silently blank.

## Security

No API keys, OAuth refresh tokens, database credentials or provider secrets are stored in browser storage. API requests use credentialed HTTP so the eventual auth layer can be added without rewriting every surface.

## Local development

```bash
cd frontend
npm install
npm run dev
npm run typecheck
npm run test
npm run build
```

Set `NEXT_PUBLIC_API_URL` to the backend API base. Optional `NEXT_PUBLIC_EVENTS_URL` enables the SSE adapter. Demo surfaces remain realistic when backend endpoints are unavailable; they intentionally do not fabricate completed server jobs.

## Current implementation status

Phase 1–9 frontend scope is implemented as a production-oriented UI foundation: app shell, reusable primitives, full route map, project pipeline, scene and visual review, content workspaces, timeline, QA/approval gates, operational libraries, API modules, polling/SSE boundary, responsive design tokens and publication guards.

Backend integration remains intentionally isolated to the API layer so another engineer can merge and wire the real endpoint contract without restructuring the UI.
