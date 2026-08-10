# TubeGen — Agent Briefing

## Mission

Build TubeGen as an end-to-end production operating system for faceless YouTube channels. The target is not merely a script generator: TubeGen should automate research, content planning, script creation, scene design, visual generation, voiceover, motion graphics, editing/rendering, QA, metadata, thumbnails and YouTube publishing.

## Product pipeline

```text
IDEA / TOPIC
  -> RESEARCH
  -> CONTENT BRIEF
  -> SCRIPT VERSION
  -> SCENE BREAKDOWN
  -> VOICEOVER
  -> TIMESTAMPS
  -> VISUAL PLAN
  -> VISUAL GENERATION / STOCK
  -> MOTION GRAPHICS (Remotion)
  -> TIMELINE
  -> RENDER
  -> QA
  -> THUMBNAIL + METADATA
  -> APPROVAL
  -> YOUTUBE UPLOAD
  -> PUBLISHED
```

## Non-negotiable engineering principles

1. **Never destructively overwrite generated content.** Use versions and generation attempts.
2. **Preserve provenance.** Every generated visual must be traceable to scene, prompt, provider, model and generation attempt.
3. **Everything expensive or long-running is asynchronous.** Research, LLM generation, TTS, image/video generation, rendering and YouTube upload run as jobs/workers.
4. **Workers must be retryable and idempotent.** A retry must not duplicate a publication or corrupt a project.
5. **Approval is a first-class domain concept.** Visual candidates, final video and other configured stages can require human approval.
6. **Provider abstraction is mandatory.** Do not couple business logic to one AI/media vendor. Implement adapters/interfaces for research, LLM, image, video, TTS and storage providers.
7. **Storage and database are separate.** PostgreSQL stores metadata and provenance; S3-compatible object storage stores media.
8. **Remotion is the motion/timeline layer.** Keep scene-level creative data independent of the rendering implementation.
9. **YouTube is a publication target, not the source of truth.** TubeGen owns project state and stores external publication IDs/status.
10. **Cost tracking matters.** Provider operations should emit cost events so project/channel budgets can be monitored.

## Canonical database

Use `prisma/schema.prisma` as the source of truth for the relational model. `docs/database-schema.md` explains the model in human-readable form.

Important lineage:

```text
Project
  -> Script (versioned)
  -> Scene
      -> SceneVersion
          -> GenerationAttempt
              -> Asset
```

Other versioned outputs:

```text
Project -> Voiceover(version) -> TimestampSegment
Project -> Timeline(version) -> Render(version)
Project -> Thumbnail(version)
Project -> VideoMetadata(version)
```

## Expected future service boundaries

Recommended modules/services:

- `research` — topic discovery, source retrieval, source ranking and research synthesis
- `content` — briefs, hooks, outlines and script versions
- `scenes` — deterministic script-to-scene breakdown
- `voice` — TTS providers and alignment/timestamps
- `visuals` — AI image/video and stock providers
- `motion` — Remotion compositions and motion templates
- `editing` — timeline construction, FFmpeg/Remotion orchestration and render jobs
- `qa` — automated checks for duration, missing assets, audio, black frames, subtitles, etc.
- `publishing` — YouTube OAuth, upload, scheduling and publication status
- `jobs` — queue, retries, priorities, locks and worker orchestration
- `storage` — signed URLs, object lifecycle and media metadata

## State machine direction

Project stages should move forward through explicit transitions rather than arbitrary status updates. A stage can be `PENDING`, `PROCESSING`, `READY_FOR_REVIEW`, `APPROVED`, `REJECTED`, `FAILED` or `SUPERSEDED` where applicable.

Do not allow a project to publish unless the required artifacts have passed configured approval/QA gates.

## UI assumptions

The product UI is an operations console. It should expose:

- pipeline stages and their status
- scene list with generated candidates
- current selected candidate and generation provenance
- approve/reject/regenerate actions
- generation attempts and errors
- asset/license status
- job activity and progress
- project/channel cost
- final render preview
- publishing status

## Agent workflow

Before changing architecture:

1. Read this file.
2. Read `docs/database-schema.md` and `prisma/schema.prisma`.
3. Inspect existing code before adding abstractions.
4. Prefer small, composable modules over one large service.
5. Add tests for state transitions and idempotency around jobs/publication.
6. Do not introduce a provider-specific data model where the canonical model can remain provider-neutral.

## MVP priority

Build the smallest complete vertical slice first:

`Project -> Research -> Script -> Scenes -> TTS -> Visuals -> Remotion timeline -> Render -> YouTube`

Human approval should be available before publication. Fully automatic publishing can be enabled later through channel configuration.
