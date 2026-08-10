# TubeGen

TubeGen is an end-to-end faceless YouTube video production platform.

## Product goal

TubeGen automates the production pipeline from topic discovery to YouTube publication:

`Research -> Brief -> Script -> Scenes -> Voiceover -> Timestamps -> Visuals -> Motion Graphics -> Timeline -> Render -> QA -> Thumbnail/Metadata -> YouTube`

The system is designed around **versioning, provenance, approvals, retries, and asynchronous jobs**. Generated content must never be destructively overwritten.

## Repository guidance

The canonical architecture and database decisions are documented in:

- `docs/AGENTS.md`
- `docs/database-schema.md`
- `prisma/schema.prisma`
- `docs/architecture.md`
- `docs/development.md`

## Backend foundation

The initial backend layer provides the API server, validation, Prisma integration, PostgreSQL Docker setup, project CRUD, centralized pipeline state transitions, persisted jobs, worker execution, provider interfaces, health endpoints and automated tests.

## Local development

```bash
cp .env.example .env
docker compose up -d
npm install
npm run prisma:generate
npm run prisma:validate
npm run build
npm test
```

Start the API with `npm run dev` and the worker with `npm run worker:dev`.

## Core architectural principle

A visual scene follows this lineage:

`Scene -> SceneVersion -> GenerationAttempt -> Asset`

This allows TubeGen to regenerate an image/video candidate, compare attempts, approve one candidate, and retain the complete provenance history.

Likewise, scripts, voiceovers, timelines and renders are versioned.
