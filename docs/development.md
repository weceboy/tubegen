# Development

## Requirements

- Node.js 20+
- Docker
- PostgreSQL via Docker Compose

## Setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm run prisma:generate
npm run prisma:validate
npm run build
```

The Prisma schema in `prisma/schema.prisma` is the canonical database model.

## Run API

```bash
npm run dev
```

## Run worker

```bash
npm run worker
```

## Tests

```bash
npm test
```

## Current scope

The foundation includes API bootstrapping, validation, structured errors, health checks, project CRUD, the centralized pipeline state machine, database-backed jobs, a worker executor and mock provider interfaces.
