# idea-analyzer

WhatsApp bot that analyzes business/app ideas dropped in a group. When someone
sends `ideia: <descrição>`, it does a critical, no-flattery analysis — market,
real competitors (via web search), validation tests, and a blunt verdict — and
replies in the group.

## How it works

```
WhatsApp group → AvisaAPI webhook → /webhook/:token
  → parseWebhook → detect "ideia:" trigger
  → LLM analysis (OpenAI + web search)
  → AvisaAPI sendText back to the group
```

- **Trigger**: messages matching `ideia:` (accent/spacing tolerant).
- **Config**: keys (OpenAI, AvisaAPI), model, group allowlist and DM toggle are
  set in the **`/admin` Integrações page** (HTTP Basic, user `admin`) and stored
  **encrypted** on disk — like Berry Money/Ops. Env holds only infra.
- **Provider**: pluggable. Starts with OpenAI using the Responses API
  `web_search` tool for real competitor grounding.

## Setup

```bash
npm install
cp .env.example .env   # infra only (WEBHOOK_TOKEN, ADMIN_PASSWORD, SECRETS_ENCRYPTION_KEY)
npm run dev            # or: npm run build && npm start
```

Then open `http://localhost:4500/admin` (user `admin`, pass `ADMIN_PASSWORD`) and
paste the OpenAI + AvisaAPI keys. Point AvisaAPI's webhook at
`https://<host>/webhook/<WEBHOOK_TOKEN>` (use ngrok in dev). The AvisaAPI driver
exposes `setWebhook` if you prefer to set it via API.

## Test without WhatsApp

```bash
curl -s localhost:4500/analyze \
  -H 'Content-Type: application/json' \
  -d '{"idea":"app para professores particulares gerirem alunos, relatórios e conteúdo","author":"Israel"}'
```

## Adding another LLM provider

Implement `IdeaProvider` (`src/providers/types.ts`) and add a case in
`buildProvider()` (`src/analyzer.ts`), plus an `<option>` in the `/admin` provider
select. The selection is user-configurable in the UI, mirroring Berry Money/Ops.
