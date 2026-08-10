# Pipeline

Project status is controlled by `PipelineService`.

```text
DRAFT
  -> RESEARCHING
  -> SCRIPTING
  -> PRODUCING
  -> REVIEW
  -> RENDERING
  -> READY
  -> PUBLISHING
  -> PUBLISHED
```

Failure recovery can return a failed project to an earlier production stage. Archived projects are terminal.

The transition rules are centralized in `src/domain/pipeline/pipeline-service.ts` and are covered by unit tests.
