# CynExtra-AI 2.2.0 — Production Hardening Release

This release keeps the existing Groq/OpenAI-compatible chat flow and adds production hardening around authentication, authorization, payment callbacks, CORS, security headers, deployment, and server lifecycle handling.

## Included

- Server-authoritative account plan synchronization in the frontend
- Protected user identity binding to authenticated sessions
- Constant-time secret/code comparisons
- Payment webhook event idempotency
- Payment return URL allow-listing
- Production environment validation
- Strict production CORS configuration
- Security response headers and HSTS in production
- Graceful shutdown handling
- Dockerfile and docker-compose deployment scaffold
- `.gitignore` protecting `.env`, uploads, temporary data, and logs
- Deployment documentation
- Existing AI, memory, learning, model, file, voice, search, and UI systems preserved

## Important

The project still uses JSON persistence for compatibility with the existing codebase. JSON is not a horizontally scalable production database. Before a large public launch, migrate persistent user/chat/memory/usage data to PostgreSQL/MySQL and file data to managed object storage.

External email, payment, AI, search, HTTPS/domain, and storage services must be configured with real credentials before those capabilities can operate in production.
