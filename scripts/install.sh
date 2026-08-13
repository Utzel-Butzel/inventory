#!/bin/sh

set -eu

if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' "Docker is required: https://docs.docker.com/engine/install/" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  printf '%s\n' "Docker Compose v2 is required." >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  printf '%s\n' "OpenSSL is required to generate secure installation secrets." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  printf '%s\n' "curl is required for the readiness check." >&2
  exit 1
fi
if [ -e .env ]; then
  printf '%s\n' ".env already exists; it was not changed."
  printf '%s\n' "Run: docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build"
  exit 2
fi

app_port="${APP_PORT:-3000}"
auth_url="${AUTH_URL:-http://localhost:${app_port}}"
admin_email="${BOOTSTRAP_ADMIN_EMAIL:-admin@inventory.local}"
admin_name="${BOOTSTRAP_ADMIN_NAME:-Inventory admin}"
postgres_password="$(openssl rand -hex 32)"
auth_secret="$(openssl rand -hex 48)"
admin_password="$(openssl rand -hex 12)"

umask 077
{
  printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
  printf 'AUTH_SECRET=%s\n' "$auth_secret"
  printf 'AUTH_URL=%s\n' "$auth_url"
  printf 'AUTH_TRUST_HOST=true\n'
  printf 'APP_PORT=%s\n' "$app_port"
  printf 'BOOTSTRAP_ADMIN_EMAIL=%s\n' "$admin_email"
  printf 'BOOTSTRAP_ADMIN_NAME=%s\n' "$admin_name"
  printf 'BOOTSTRAP_ADMIN_PASSWORD=%s\n' "$admin_password"
  printf 'BOOTSTRAP_ADMIN_PASSWORD_ONCE=true\n'
  printf 'STORAGE_PROVIDER=local\n'
} > .env

printf '%s\n' "Created .env with installation-specific secrets."
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build

printf '%s\n' "Waiting for Open Inventory to become healthy..."
attempt=0
until curl -fsS "http://127.0.0.1:${app_port}/api/health" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    printf '%s\n' "The stack did not become healthy in time." >&2
    printf '%s\n' "Inspect it with: docker compose logs app migrate db" >&2
    exit 1
  fi
  sleep 2
done

printf '\n%s\n' "Open Inventory is ready."
printf 'URL:      %s\n' "$auth_url"
printf 'Email:    %s\n' "$admin_email"
printf 'Password: %s\n' "$admin_password"
printf '\n%s\n' "Sign in once, then change the password under Settings -> Users."
