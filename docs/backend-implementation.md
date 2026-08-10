# TubeGen Backend Implementation

This branch completes the backend vertical slice described by `docs/AGENTS.md`.

## Runtime flow

`Project -> Research -> Brief -> Script -> Scenes -> Voiceover/Timestamps -> Visuals -> Motion -> Timeline -> Render -> QA -> Thumbnail/Metadata -> Approval -> YouTube`

All expensive stages are represented as database jobs and executed by the worker. Jobs use idempotency keys, atomic queued-to-running claiming, retry limits and persisted results/errors.

## Provider boundaries

Provider-neutral contracts cover LLM/research (existing mock providers), voice, visuals, rendering, publishing and object storage. The default implementation is mock-only so the complete pipeline can be exercised without external vendor credentials. Production adapters can be added without changing project/domain models.

## Provenance

Visual output is persisted as `SceneVersion -> GenerationAttempt -> Asset` and linked to scenes through `SceneAsset`. Voiceover output is persisted as a versioned `Voiceover` with `TimestampSegment` records. Timelines and renders are versioned.

## Approval / publication

Publication is blocked unless a `PUBLICATION` approval exists for the requesting user and a successful render exists. The YouTube worker uses the publishing provider contract and persists the external video ID/status.

## Storage

Media is represented by object-storage keys. The mock storage provider demonstrates the boundary; no media binary is placed in PostgreSQL.

## Production adapters still expected

Replace the mock providers with real implementations for the chosen research/LLM/TTS/image/video/Remotion/FFmpeg/storage/YouTube vendors. The domain contracts and persistence model are already provider-neutral.

## Validation

The repository CI runs `npm install`, `prisma generate`, TypeScript build and Vitest. Runtime integration requires PostgreSQL; use the repository Docker Compose configuration and environment example.
