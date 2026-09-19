# Frontend (Next.js). Build-Kontext ist das Repo-Root:
#   docker build -f apps/frontend/Dockerfile -t palantir-frontend .
#
# ACHTUNG - Domainname: NEXT_PUBLIC_-Variablen setzt Next.js zur BAUZEIT in das
# Browser-Bundle ein. `PALANTIR_DOMAIN` muss deshalb beim Bauen bekannt sein und
# wird als Build-Argument übergeben. Ein Domainwechsel erfordert bei diesem
# Image also einen Neubau - anders als bei Backend und Agent, die den Wert zur
# Laufzeit aus der .env lesen. (Hintergrund stand in docs/ci-cd.md - nicht mehr im
# Repo, siehe Historie.)

# Digest-gepinnt (Review 2026-09-16, Befund 8.5): Das Tag `24-bookworm-slim` wandert
# mit jedem Node-Patch, der Digest nicht. Dependabot zieht ihn nach
# (`.github/dependabot.yml`, Oekosystem `docker` je App-Verzeichnis).
FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app


# --- Abhängigkeiten -----------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/agent/package.json apps/agent/
COPY packages/contracts/package.json packages/contracts/
COPY packages/validation/package.json packages/validation/
RUN pnpm install --frozen-lockfile


# --- Bauen --------------------------------------------------------------------
FROM deps AS build
ARG PALANTIR_DOMAIN
ENV PALANTIR_DOMAIN=${PALANTIR_DOMAIN}
# Adresse der API, wie der Browser sie sieht (Fundpunkt 313).
#
# Ohne Angabe leitet `next.config.mjs` daraus `https://api.<PALANTIR_DOMAIN>` ab
# - zwei Hosts, und damit Sitzungs-Cookies, die fuer die Elterndomain gelten und
# jede Spiel-Subdomain miterreichen. Wer die API unter denselben Host legt
# (`https://<Domain>/api`), traegt den Wert hier ein; er wird beim BAUEN in das
# Browser-Bundle geschrieben, nicht zur Laufzeit gelesen. Eine Aenderung wirkt
# deshalb erst nach einem Neubau des Images.
ARG PUBLIC_API_URL
ENV PUBLIC_API_URL=${PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/frontend ./apps/frontend

# Die Workspace-Packages zuerst bauen - das Frontend bindet sie über
# transpilePackages ein, braucht aber deren Typen aus dist/.
RUN pnpm --filter @palantir/frontend... build


# --- Laufzeit -----------------------------------------------------------------
# `output: standalone` legt unter .next/standalone einen fertigen Server ab.
# Statische Dateien und der public-Ordner werden davon nicht erfasst und müssen
# getrennt kopiert werden - das ist so vorgesehen, nicht vergessen.
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/apps/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=build --chown=node:node /app/apps/frontend/public ./apps/frontend/public

USER node

EXPOSE 3000

CMD ["node", "apps/frontend/server.js"]
