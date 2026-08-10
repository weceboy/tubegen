# TubeGen Frontend

Desktop-first production cockpit for TubeGen. The backend and Prisma schema remain the source of truth for production state and data models.

## Architecture

- Next.js App Router + React
- TanStack Query for server state
- Centralized API client in `lib/api.ts`
- UI state kept local to interactive surfaces
- Route surfaces prepared for polling/SSE without exposing credentials
- Publication is approval-gated and never inferred from asset existence

## Routes

`/dashboard`, `/projects`, `/projects/:id`, `/projects/:id/research`, `/projects/:id/script`, `/projects/:id/scenes`, `/projects/:id/voiceover`, `/projects/:id/visuals`, `/projects/:id/edit`, `/projects/:id/review`, `/projects/:id/publish`, `/queue`, `/assets`, `/channels`, `/templates`, `/providers`, `/settings`.

## Local development

```bash
cd frontend
npm install
npm run dev
```

The API base is configured with `NEXT_PUBLIC_API_URL`; the UI falls back to `http://localhost:3000/api` for local development. No provider credentials or YouTube OAuth secrets belong in the frontend.

## Current phase

Phase 1-3 foundation is implemented with realistic `$6 Handpowered Washer` demo state, production pipeline navigation, scene/visual review, generation state, declarative timeline, project wizard, empty/error-oriented surfaces, centralized API types, and publication gate tests.

Backend endpoints are not yet fully exposed as a stable public API, so demo surfaces intentionally remain mock-backed. Replacing them with live queries should only require wiring the existing `lib/api.ts` methods to the backend routes.
