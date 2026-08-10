# TubeGen Database Schema

PostgreSQL is the system of record for TubeGen production state. Media binaries live in object storage; the DB stores references, metadata, provenance, approvals and workflow state.

## 1. Tenancy / channels

### User
Owns channels, projects and approval decisions.

### Channel
Represents a YouTube channel and contains language, niche, brand settings, automation settings and YouTube channel identity.

`User 1 -> N Channel`

## 2. Project

A Project is one video production job.

Key fields:

- topic
- target language
- target duration
- status/current stage
- budget
- channel/owner

A project is the root for all production artifacts.

## 3. Research

`Project 1 -> 1 Research -> N Source`

Research stores synthesized findings, recommended angle, keywords, competitor data, content gaps and facts. Sources retain URL, title, domain, publication date, credibility and excerpts.

## 4. Content Brief

`Project 1 -> 1 ContentBrief`

Contains title/hook/promise/audience and structured outline information.

## 5. Scripts

`Project 1 -> N Script`

Scripts are immutable versions. A new script is a new version; downstream scene/voice/timeline outputs can be regenerated from it.

## 6. Scenes

`Project 1 -> N Scene`

Each scene has narration, duration and visual/motion prompts.

A scene has versions:

`Scene -> N SceneVersion`

A scene version contains the exact creative specification at a point in time.

## 7. AI generation provenance

`SceneVersion -> N GenerationAttempt -> N Asset`

Every AI visual generation is represented by a GenerationAttempt with:

- provider
- model
- prompt
- negative prompt
- parameters
- status
- timestamps
- error

The resulting Asset stores object-storage key, media metadata, provider IDs, licensing information and selection status.

This is the core mechanism for **reroll / regenerate / compare / approve**.

## 8. Scene assets

`Scene <-> Asset` through `SceneAsset`.

A scene can contain multiple assets with explicit roles, order and time ranges. This supports primary visual, overlay, B-roll, background and other production roles without hard-coding them into the scene itself.

## 9. Voiceover

Channels have reusable `VoiceProfile` records.

`Project -> N Voiceover(version)`

A voiceover references an audio Asset and stores transcript/duration.

`Voiceover -> N TimestampSegment`

Timestamp segments connect speech timing to scenes and are the synchronization bridge between narration and visual timeline construction.

## 10. Motion graphics / Remotion

`Channel -> N MotionTemplate`

`Scene -> N MotionClip`

Motion templates are reusable Remotion composition definitions/configuration. Motion clips attach a template and optional asset to a scene with start/end timing and JSON props.

The database does **not** store Remotion implementation code. It stores template keys/configuration so the rendering layer remains replaceable.

## 11. Timeline and render

`Project -> N Timeline(version) -> N Render(version)`

Timeline stores the resolved production plan:

- FPS
- dimensions
- duration
- structured timeline data

Render stores the actual rendered output and provider/status/error information.

## 12. Thumbnail and metadata

`Project -> N Thumbnail(version)`

`Project -> N VideoMetadata(version)`

Metadata includes title, description, tags, hashtags, chapters, category and language.

## 13. Approval gates

`Project -> N Approval`

Approvals are explicit decisions by users for a configured stage/artifact. Typical gates:

- visual candidate approval
- final video approval
- publication approval

Do not infer approval from an asset merely existing.

## 14. Jobs

`Project -> N Job`

Jobs are asynchronous workflow units for:

- research
- LLM generation
- scene breakdown
- TTS/transcription
- image/video generation
- motion generation
- timeline construction
- rendering
- QA
- YouTube upload

Jobs have priority, retry count, schedule, status and structured payload/result.

## 15. Publications

`Project -> N Publication`

A publication stores the external YouTube video ID, visibility, scheduling information, status and provider response. This allows one project to potentially have multiple publication attempts/targets.

## 16. Cost events

`Project -> N CostEvent`

Provider operations emit cost records. This enables per-video and per-channel budget tracking without coupling the core project model to a particular provider's billing API.

## Entity relationship overview

```text
User
 └── Channel
      ├── VoiceProfile
      ├── MotionTemplate
      └── Project
           ├── Research ── Source[]
           ├── ContentBrief
           ├── Script[] ── Scene[]
           │               ├── SceneVersion[]
           │               │    └── GenerationAttempt[] ── Asset[]
           │               ├── SceneAsset[] ── Asset
           │               └── MotionClip[] ── MotionTemplate / Asset
           ├── Voiceover[] ── TimestampSegment[]
           ├── Timeline[] ── Render[]
           ├── Thumbnail[] ── Asset
           ├── VideoMetadata[]
           ├── Approval[]
           ├── Artifact[]
           ├── Job[]
           ├── Publication[]
           └── CostEvent[]
```

## Versioning / invalidation rule

When an upstream artifact changes, downstream artifacts become candidates for regeneration rather than being silently mutated.

Example:

`Script v2 -> Scene v2 -> Voiceover v2 -> Timeline v2 -> Render v2`

A thumbnail change must not invalidate the render. A script change normally invalidates the dependent scene/voice/timeline/render chain.

## Storage rule

Never put large binary video/audio/image data directly into PostgreSQL. Store it in S3-compatible storage and put only the `storageKey`, metadata, checksum and licensing information in PostgreSQL.
