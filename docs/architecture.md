# TubeGen Backend Architecture

## Current implementation

The backend currently provides the foundation layer:

```text
HTTP API
  -> Application services
  -> Domain pipeline state machine
  -> Prisma repositories/services
  -> PostgreSQL

Job API
  -> Job table
  -> Worker poll/claim
  -> Provider adapter
  -> Persisted result
```

Long-running work is represented as database-backed jobs rather than being executed inside HTTP requests.

## Boundaries

- `src/api` owns HTTP transport, validation and error mapping.
- `src/services` owns application use cases.
- `src/domain` owns pipeline rules.
- `src/providers` owns provider interfaces and adapters.
- `src/jobs` owns job execution orchestration.
- `src/db` owns Prisma access.

The canonical relational model remains `prisma/schema.prisma`.

## Provider neutrality

Business services depend on provider interfaces such as `LLMProvider` and `ResearchProvider`. Mock implementations are available for local development and tests.

## State transitions

Project status transitions are centralized in `PipelineService`; arbitrary string updates are not permitted by the project transition endpoint.
