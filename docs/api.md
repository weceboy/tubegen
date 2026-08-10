# API

## Health

- `GET /health`
- `GET /health/db`
- `GET /health/workers`

## Channels

- `GET /channels`
- `POST /channels`
- `GET /channels/:id`
- `PATCH /channels/:id`
- `DELETE /channels/:id`

## Projects

- `GET /projects`
- `POST /projects`
- `GET /projects/:id`
- `PATCH /projects/:id`
- `DELETE /projects/:id`
- `POST /projects/:id/transition`
- `GET /projects/:id/jobs`

## Jobs

- `POST /jobs/:id/cancel`

API validation errors use a consistent response shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed."
  }
}
```
