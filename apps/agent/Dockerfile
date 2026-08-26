# Homeserver-Agent. Build-Kontext ist das Repo-Root:
#   docker build -f apps/agent/Dockerfile -t palantir-agent .
#
# Läuft in der Gameserver-VM und spricht ausschließlich über den
# Docker-Socket-Proxy mit Docker (Pflichtenheft §2.3). Das Image bekommt daher
# bewusst KEINEN Zugriff auf den Docker-Socket - der Proxy wird über
# DOCKER_SOCKET_PROXY_URL angesprochen.

FROM node:24-bookworm-slim AS base
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
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/agent ./apps/agent
RUN pnpm --filter @palantir/agent... build


# --- Produktionsabhängigkeiten ------------------------------------------------
FROM deps AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @palantir/agent...


# --- Laufzeit -----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/agent/node_modules ./apps/agent/node_modules
COPY --from=prod-deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=prod-deps /app/packages/validation/node_modules ./packages/validation/node_modules

COPY pnpm-workspace.yaml package.json ./
COPY apps/agent/package.json ./apps/agent/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/validation/package.json ./packages/validation/

COPY --from=build /app/apps/agent/dist ./apps/agent/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/validation/dist ./packages/validation/dist

USER node

# Kein EXPOSE: der Agent nimmt keine eingehenden Verbindungen an, sondern baut
# die Verbindung zum Backend selbst auf (Pflichtenheft §1).

CMD ["node", "apps/agent/dist/index.js"]
