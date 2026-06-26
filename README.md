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
- **Provider**: pluggable (`LLM_PROVIDER`). Starts with OpenAI using the
  Responses API `web_search` tool for real competitor grounding.
- **Scope**: groups only by default (`GROUP_ALLOWLIST` to restrict to specific
  groups; `ALLOW_DIRECT=true` to also answer DMs).

## Setup

```bash
npm install
cp .env.example .env   # fill AVISA_* and OPENAI_API_KEY
npm run dev            # or: npm run build && npm start
```

Point AvisaAPI's webhook at `https://<host>/webhook/<WEBHOOK_TOKEN>` (use ngrok
in dev). The AvisaAPI driver exposes `setWebhook` if you prefer to set it via API.

## Test without WhatsApp

```bash
curl -s localhost:4500/analyze \
  -H 'Content-Type: application/json' \
  -d '{"idea":"app para professores particulares gerirem alunos, relatórios e conteúdo","author":"Israel"}'
```

## Adding another LLM provider

Implement `IdeaProvider` (`src/providers/types.ts`) and add a case in
`buildProvider()` (`src/analyzer.ts`). The user-configurable selection mirrors
Berry Money/Ops (chosen via env for now).
