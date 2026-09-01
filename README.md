# CynExtra-AI

CynExtra-AI is a modular AI assistant workspace with a preserved OpenAI-compatible/Groq chat path and explicit capability adapters.

## What is real vs provider-dependent

The backend never fakes unsupported capabilities.

- **Chat:** uses `AI_BASE_URL`, `AI_API_KEY`, and model configuration. Groq remains supported through the existing OpenAI-compatible provider.
- **Search:** DuckDuckGo by default; Serper/Tavily can be configured.
- **Memory:** user-scoped JSON storage in the current development architecture.
- **Learning:** extracts preferences/memories and creates pending training candidates. It never changes provider model weights.
- **Image generation:** only enabled when a real image provider adapter is configured.
- **Video generation:** only enabled when a real video provider adapter is configured.
- **Vision:** capability is reported as unavailable until a real vision-capable provider path is connected.
- **Files:** safe base64 processing for TXT/CSV/JSON and common images. PDF/DOCX are intentionally not claimed as supported by this build.
- **Tools:** permission-aware and timeout-protected. No unrestricted shell access is exposed to the AI.

## Architecture

```text
Website / Android app
        |
        v
     Express API
        |
        +--> Auth / rate limiting / validation
        |
        +--> Brain
        |      +--> Memory
        |      +--> Learning
        |      +--> Knowledge
        |      +--> Search
        |      +--> Tools
        |      +--> Chat Provider (Groq/OpenAI-compatible)
        |      +--> Image Provider adapter
        |      +--> Video Provider adapter
        |
        +--> JSON development data
```

The existing chat flow remains:

```text
chat.html
  -> assets/js/main.js
  -> POST /api/chat
  -> routes/api.js
  -> ai/brain.js
  -> ai/provider.js
  -> configured provider (Groq-compatible by default)
```

## Folder structure

```text
CynExtra-AI/
├── index.html
├── login.html
├── signup.html
├── chat.html
├── library.html
├── projects.html
├── plugins.html
├── profile.html
├── settings.html
├── pricing.html
├── terms.html
├── assets/
│   ├── css/style.css
│   ├── js/main.js
│   ├── audio/background.mp3
│   └── images/
└── backend/
    ├── server.js
    ├── package.json
    ├── package-lock.json
    ├── .env.example
    ├── ai/
    │   ├── brain.js
    │   ├── provider.js
    │   ├── models.js
    │   ├── memory.js
    │   ├── learning.js
    │   ├── knowledge.js
    │   ├── search.js
    │   ├── tools.js
    │   ├── terminal.js
    │   └── providers/
    │       ├── image.js
    │       └── video.js
    ├── middleware/
    │   └── rateLimit.js
    ├── services/
    │   ├── auth.js
    │   └── fileService.js
    ├── routes/
    │   └── api.js
    └── data/
        ├── users.json
        ├── chats.json
        ├── memories.json
        ├── training_examples.json
        └── knowledge.json
```

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Set at least:

```env
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=YOUR_REAL_GROQ_KEY
AI_MODEL=llama-3.3-70b-versatile
AI_PROVIDER=openai-compatible
```

For a real deployment also set a long random `AUTH_SECRET` and `ADMIN_KEY`, then use:

```env
AUTH_REQUIRED=true
```

Do not put provider keys in frontend JavaScript.

Start:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Do not open the HTML files with `file://`.

## API capabilities

- `GET /health`
- `GET /api/health`
- `GET /api/status`
- `GET /api/capabilities`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/models`
- `POST /api/chat`
- `GET /api/chats`
- `GET /api/chats/:id`
- `DELETE /api/chats/:id`
- `POST /api/search`
- `GET /api/tools`
- `POST /api/tools/execute`
- `POST /api/media/image`
- `POST /api/media/video`
- `POST /api/files/process`
- `GET /api/learning/profile`
- `GET /api/learning/memories`
- `DELETE /api/learning/memories/:memoryId`
- `GET /api/learning/training`
- `POST /api/learning/training/:exampleId/status`
- `GET /api/learning/training/export`
- `GET /api/knowledge`
- `POST /api/terminal`

## Learning pipeline

```text
User message + AI response
        |
        v
Learning analyzer
        |
        +--> user preference
        +--> useful/important memory
        +--> detected language
        +--> potential training candidate
                    |
                    v
                 pending
                    |
          human/admin review
              /           \
         approved        rejected
             |
             v
     approved dataset export
             |
             v
       future fine-tuning
```

No chat message automatically modifies Groq/provider model weights.

Approved examples can be exported as JSONL, OpenAI-style message JSON, or Alpaca-style JSON. Fine-tuning itself remains a separate provider/training job.

## Ultimate Mode

Ultimate is still an orchestration/policy mode, not a fake new model.

The backend verifies the user's plan server-side. Frontend flags are not trusted for authorization.

Ultimate can unlock additional tool permissions and model profiles when the server-side plan allows them. Tool execution also uses server-derived permissions instead of trusting a client-provided permission list.

## Image and video

Image and video are adapter-based.

Example image configuration:

```env
IMAGE_PROVIDER=your-provider
IMAGE_API_URL=https://provider.example/v1/images/generations
IMAGE_API_KEY=YOUR_REAL_KEY
IMAGE_MODEL=YOUR_REAL_MODEL
```

Example video configuration:

```env
VIDEO_PROVIDER=your-provider
VIDEO_API_URL=https://provider.example/v1/videos
VIDEO_API_KEY=YOUR_REAL_KEY
VIDEO_MODEL=YOUR_REAL_MODEL
```

These are configuration examples, not fake providers or fake endpoints. Replace them with the actual API endpoint and model documented by the provider you choose.

The `/api/capabilities` endpoint reports whether each capability is actually configured. The chat UI only adds generation controls when the corresponding backend capability is available.

## Security

- API keys stay server-side.
- `AUTH_REQUIRED=true` enables signed bearer-token authentication.
- Passwords in server-auth accounts use Node `scrypt`.
- User IDs must match authenticated bearer tokens when authentication is required.
- Plan changes require the admin key.
- Training approval/export requires the admin key.
- Tool permissions are derived server-side from plan.
- Tool execution has a timeout.
- API requests have an in-memory rate limiter.
- Request body size is limited.
- Static access to `backend`, `.env`, `.git`, and `node_modules` is blocked.
- File processing validates MIME/extension and size.
- The existing terminal module remains allow-listed; arbitrary AI shell access is not provided.

## Testing

Run JavaScript syntax checks:

```bash
cd backend
for f in $(find . -type f -name '*.js' | sort); do node --check "$f" || exit 1; done
node --check ../assets/js/main.js
```

Then start the backend and check:

```text
GET  /health
GET  /api/health
GET  /api/status
GET  /api/capabilities
POST /api/auth/signup
POST /api/auth/login
POST /api/chat
```

For production testing, set `AUTH_REQUIRED=true` and verify that unauthenticated user-data requests return `401`.

## Current limitations

This build is a strong modular development foundation, not a claim that one provider has all ChatGPT/Claude/Grok capabilities.

- JSON storage is appropriate for development/small deployments; production scale should move to a transactional database plus object storage.
- Vision requires a real multimodal provider adapter.
- PDF/DOCX extraction needs dedicated parsers or a document-processing service before being advertised as supported.
- Streaming/SSE is not yet part of the existing chat contract.
- Video providers commonly use asynchronous jobs; the adapter returns a real provider job ID/status when supplied, but does not invent a completed video URL.
- Fine-tuning must be performed by a real training provider/job after approved dataset export.


## AI Learning and Training Dataset

CynExtra-AI keeps memory and training data separate.

- Chat still uses the existing `brain.js -> provider.js -> configured provider` path.
- Learning runs after a successful assistant response and is non-blocking.
- User preferences and explicit memories remain user-scoped.
- Training candidates are quality-filtered and stored as `pending`, `approved`, or `rejected`.
- Exact duplicate candidates are detected with a SHA-256 fingerprint across the training dataset.
- Credentials, tokens, API keys, obvious authentication secrets, and prompt-injection examples are excluded from training candidates.
- Only an admin with `ADMIN_KEY` can approve/reject candidates or export approved data.
- JSONL export contains only `messages` and does not expose `userId` or `chatId`.
- No chat changes Groq/provider model weights. Actual fine-tuning requires a separate training infrastructure/provider.

### Dataset export

`GET /api/learning/training/export?format=jsonl` exports all approved examples for an admin request.

A user-scoped export may be requested with `?userId=<id>`. Supported formats are `jsonl`, `openai`, and `alpaca`. These formats are dataset representations; provider-specific fine-tuning compatibility must be verified against the target training service.

Set a strong `ADMIN_KEY` and, for production authentication, set `AUTH_REQUIRED=true`.


## Hardened account, plan and usage controls

- Server-side daily usage is stored in `backend/data/usage.json`.
- Free/Basic: 300 prompts/day and 60 files/images/day.
- Pro: 1,500 prompts/day and 500 files/images/day.
- Ultimate: 3,000 prompts/day and 2,000 files/images/day by default; both Ultimate values are configurable with `ULTIMATE_DAILY_PROMPTS` and `ULTIMATE_DAILY_FILES`.
- Model access is enforced on the server: Swift = Free/Basic, Nova = Pro, Core/Think/Code/Max = Ultimate. Vision remains unavailable until a real vision provider is configured.
- Frontend plan/model state is never trusted for authorization.
- Password recovery uses a one-time six-digit code, ten-minute expiry and five-attempt limit. A real email transport must be configured with `EMAIL_API_URL`, `EMAIL_API_KEY`, and optionally `EMAIL_FROM`.
- Paid-plan activation is payment-provider driven. The app does not locally mark a payment as successful. Configure `PAYMENT_PROVIDER`, `PAYMENT_CHECKOUT_URL`, `PAYMENT_API_KEY`, and `PAYMENT_WEBHOOK_SECRET` for a real checkout/webhook integration.
- Payment webhooks are HMAC verified before the server updates a user's plan.
- File uploads are stored under a hashed per-user directory and never expose arbitrary filesystem paths.
- The current provider path is text-only unless a real multimodal provider is configured. Uploaded text files can be supplied as untrusted context to the model; image files can be stored but are not claimed to be understood by a text-only model.
- Voice input uses the browser/device SpeechRecognition API when available. Unsupported browsers report the limitation instead of simulating microphone input.

## Important deployment limitation

This ZIP is a hardened, testable development/small-deployment foundation. It is **not** a claim of full production-scale infrastructure. JSON-file persistence and in-memory rate limiting are not suitable for multi-instance production. A real production deployment should move users/chats/memories/usage/payments to a transactional database, use object storage for uploads, use a distributed rate limiter, and use an HttpOnly cookie/session architecture or another hardened session service.

## UI Repair Note (2026-08-19)

The chat page structure was repaired after a malformed HTML edit had removed the sidebar/main workspace shell. The repaired page restores the navigation sidebar, workspace top bar, chat area, composer, plus menu, model selector, file inputs, voice control, mobile overlay, and closing document structure.

The chat composer now advertises only file types that the current backend file service actually processes: TXT, CSV, JSON, PNG, JPEG/JPG, WebP, and GIF.

Demo user/assistant conversation messages were removed so the interface does not present fabricated chat history. The initial welcome message remains.

## Response UX update

The chat UI now includes a real request-status panel and a response loading animation. The status panel shows only high-level application state (preparing, sending, waiting for the model, finalizing); it does not expose hidden chain-of-thought or private model reasoning. The typing indicator remains visible until the actual provider response is received, so the UI does not simulate token streaming.

The assistant system instructions were also strengthened for language consistency, useful structure, coding quality, memory isolation, honesty about capabilities, and safe handling of internal reasoning.


## AI capability layer

CynExtra-AI now supports context-aware memory, learning analysis, automatic freshness search for time-sensitive questions, safe calculator/random tools, file text context, optional vision, and provider-backed image/video adapters. Paid search providers gracefully fall back to DuckDuckGo when no key is configured. Image/video generation and vision remain disabled until a compatible provider/model is configured; the app does not pretend those capabilities are active.
