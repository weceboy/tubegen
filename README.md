# TubeGen

TubeGen is an end-to-end faceless YouTube video production platform.

## Product goal

TubeGen automates the production pipeline from topic discovery to YouTube publication:

`Research -> Brief -> Script -> Scenes -> Voiceover -> Timestamps -> Visuals -> Motion Graphics -> Timeline -> Render -> QA -> Thumbnail/Metadata -> YouTube`

The system is designed around **versioning, provenance, approvals, retries, and asynchronous jobs**. Generated content must never be destructively overwritten.

## Repository guidance

The canonical architecture and database decisions are documented in:

- `docs/AGENTS.md` — briefing for all coding agents
- `docs/database-schema.md` — human-readable database model
- `prisma/schema.prisma` — canonical Prisma/PostgreSQL schema

## Core architectural principle

A visual scene follows this lineage:

`Scene -> SceneVersion -> GenerationAttempt -> Asset`

This allows TubeGen to regenerate an image/video candidate, compare attempts, approve one candidate, and retain the complete provenance history.

Likewise, scripts, voiceovers, timelines and renders are versioned.
