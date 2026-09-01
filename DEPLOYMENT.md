# CynExtra-AI production deployment

## Required before public launch

1. Copy `backend/.env.example` to `backend/.env`.
2. Set `NODE_ENV=production`.
3. Generate unique `AUTH_SECRET` and `ADMIN_KEY` (32+ characters).
4. Configure the real AI provider and key.
5. Set `CORS_ORIGINS` to the exact HTTPS frontend origin(s).
6. Configure a real email provider for password recovery.
7. Configure a real payment provider and signed webhook secret if paid plans are enabled.
8. Put the service behind HTTPS/TLS (reverse proxy or managed platform).
9. Keep `backend/.env` out of source control.
10. Back up `backend/data` if JSON storage is used.

## Important storage limitation

The current codebase retains JSON storage for compatibility with the existing project. It is appropriate for local development and a single small instance, but it is **not a horizontally scalable production database**. Before serving a large public user base, migrate the storage layer to PostgreSQL/MySQL and object storage.

## Docker

```bash
docker compose up -d --build
```

Check `http(s)://your-domain/health`.

## Never expose

- `backend/.env`
- API keys
- `AUTH_SECRET`
- `ADMIN_KEY`
- payment webhook secret
- email API keys
