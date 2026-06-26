# Deploy — ideias.berrysystem.com.br

Same shared-infra pattern as Berry Money/Ops on the KingHost VPS
(`israel@191.252.214.184`): build the image **locally**, transfer it, run via
docker compose behind the shared nginx `reverse-proxy`. Project lives in
`/srv/projects/idea-analyzer`.

## 0. Prereqs (one-time, manual)

1. **DNS**: add an A record `ideias.berrysystem.com.br → 191.252.214.184`
   (DNS panel). Wait for it to resolve before requesting the cert.
2. **Infra env**: fill `.env.production` on the server (never commit it) — only
   `WEBHOOK_TOKEN`, `ADMIN_PASSWORD`, `SECRETS_ENCRYPTION_KEY`. The OpenAI/AvisaAPI
   keys and group allowlist are NOT here — they're set later in the `/admin`
   Integrações UI (stored encrypted in the `idea-analyzer-settings` volume).

## 1. Build local + transfer image

```bash
# local (Docker amd64):
docker build --platform linux/amd64 -t idea-analyzer:latest .
docker save idea-analyzer:latest | gzip -1 \
  | ssh -o ServerAliveInterval=15 israel@191.252.214.184 'gunzip | docker load'
```

## 2. Ship code + env (compose file etc.)

```bash
# code (repo is private → no git clone on the server); excludes .env.production:
git archive --format=tar HEAD \
  | ssh israel@191.252.214.184 'mkdir -p /srv/projects/idea-analyzer && tar xf - -C /srv/projects/idea-analyzer'
# first time only — create the env from the example and fill it:
ssh israel@191.252.214.184 'cd /srv/projects/idea-analyzer && cp -n .env.production.example .env.production && chmod 600 .env.production && nano .env.production'
```

## 3. TLS cert (certbot webroot)

The `reverse-proxy` serves `/.well-known/acme-challenge/` from `/var/www/certbot`.
The vhost's `:443` block references a cert that doesn't exist yet, so install the
**http-only** part first (or temporarily comment the `server { listen 443 ... }`
block), reload nginx, then issue the cert, then add the full conf:

```bash
# drop conf, reload, issue cert, reload again:
scp deploy/ideias.conf israel@191.252.214.184:/srv/infra/reverse-proxy/conf/ideias.conf
ssh israel@191.252.214.184 'sudo certbot certonly --webroot -w /var/www/certbot -d ideias.berrysystem.com.br'
ssh israel@191.252.214.184 'docker exec reverse-proxy nginx -t && docker exec reverse-proxy nginx -s reload'
```

## 4. Up

```bash
ssh israel@191.252.214.184 'cd /srv/projects/idea-analyzer && docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-build'
```

## 5. Configure keys in the UI

Open `https://ideias.berrysystem.com.br/admin` (HTTP Basic — user `admin`, pass
`ADMIN_PASSWORD`) and paste the **OpenAI API key**, **AvisaAPI key/base URL**, and
(optionally) the **group JID** allowlist. Saved encrypted to the volume.

## 6. Point AvisaAPI at the webhook

Webhook URL: `https://ideias.berrysystem.com.br/webhook/<WEBHOOK_TOKEN>`
Set it in the AvisaAPI panel, or via the driver's `setWebhook` helper.

## Verify

```bash
curl https://ideias.berrysystem.com.br/health           # {"status":"ok",...}
# then in the WhatsApp group: "ideia: <sua ideia>"
```
