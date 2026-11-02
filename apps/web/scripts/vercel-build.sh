#!/usr/bin/env bash
# The website's build on Vercel (`npm run vercel-build`, set as the project's
# build command): apply the database migrations on the production target of
# the project (for the staging project, that is staging), then build.
# Previews never migrate: they would share that database.
set -euo pipefail

case "${VERCEL_ENV:-}" in
  production)
    echo "vercel-build: prisma migrate deploy"
    PRISMA_HIDE_UPDATE_MESSAGE=1 npx prisma migrate deploy
    ;;
  preview | development)
    echo "vercel-build: no migration on ${VERCEL_ENV}"
    ;;
  *)
    echo "vercel-build: VERCEL_ENV must be production, preview or development (got '${VERCEL_ENV:-}')" >&2
    exit 1
    ;;
esac

npx next build
