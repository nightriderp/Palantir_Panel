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
# Setzt bewusst auf `base` auf und NICHT auf `deps`: dort liegt bereits der
# vollständige Baum aller Workspaces. Ein nachträgliches `--prod` entfernt zwar
# die Verweise, räumt den virtuellen Store unter node_modules/.pnpm aber nicht
# nach - das Image trüge sonst Next.js, Turbo und TypeScript ohne Nutzen mit.
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/agent/package.json apps/agent/
COPY packages/contracts/package.json packages/contracts/
COPY packages/validation/package.json packages/validation/
RUN pnpm install --frozen-lockfile --prod --filter @palantir/agent...


# --- Laufzeit -----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

# Die ganze Stufe auf einmal: sie enthält bereits die Manifeste und die
# node_modules auf allen Ebenen. Einzeln benannte Pfade wären fehleranfällig -
# `packages/contracts` etwa hat gar keine Produktionsabhängigkeiten und damit
# auch kein eigenes node_modules.
COPY --from=prod-deps /app ./

COPY --from=build /app/apps/agent/dist ./apps/agent/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/validation/dist ./packages/validation/dist

USER node

# Kein EXPOSE: der Agent nimmt keine eingehenden Verbindungen an, sondern baut
# die Verbindung zum Backend selbst auf (Pflichtenheft §1).

CMD ["node", "apps/agent/dist/index.js"]
