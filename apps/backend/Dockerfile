# Backend-API (Fastify). Build-Kontext ist das Repo-Root, nicht dieses
# Verzeichnis - im Monorepo werden Lockfile und die Workspace-Packages gebraucht:
#   docker build -f apps/backend/Dockerfile -t palantir-backend .
#
# Debian-Basis statt Alpine: @node-rs/argon2 ist ein natives Modul und bringt
# vorgebaute Binärdateien für glibc mit. Unter musl müsste es aus den Quellen
# gebaut werden - eine Rust-Toolchain im Image wäre der Preis dafür.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Die pnpm-Version kommt aus dem Feld "packageManager" der Wurzel-package.json.
RUN corepack enable
WORKDIR /app


# --- Abhängigkeiten -----------------------------------------------------------
# Nur die Manifeste kopieren: solange sich Lockfile und package.json nicht
# ändern, bleibt diese Schicht im Cache und die Installation entfällt.
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
COPY apps/backend ./apps/backend
# `...` baut die Workspace-Abhängigkeiten (contracts, validation) mit.
RUN pnpm --filter @palantir/backend... build


# --- Produktionsabhängigkeiten ------------------------------------------------
# Setzt bewusst auf `base` auf und NICHT auf `deps`: dort liegt bereits der
# vollständige Baum aller Workspaces. Ein nachträgliches `--prod` entfernt zwar
# die Verweise, räumt den virtuellen Store unter node_modules/.pnpm aber nicht
# nach - das Backend-Image trug dadurch Next.js samt SWC-Binärdateien, Turbo und
# TypeScript mit sich herum, rund 1 GB ohne jeden Nutzen.
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/agent/package.json apps/agent/
COPY packages/contracts/package.json packages/contracts/
COPY packages/validation/package.json packages/validation/
RUN pnpm install --frozen-lockfile --prod --filter @palantir/backend...


# --- Laufzeit -----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

# Die ganze Stufe auf einmal: sie enthält bereits die Manifeste und die
# node_modules auf allen Ebenen. Einzeln benannte Pfade wären fehleranfällig -
# `packages/contracts` etwa hat gar keine Produktionsabhängigkeiten und damit
# auch kein eigenes node_modules.
COPY --from=prod-deps /app ./

COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/validation/dist ./packages/validation/dist

# Die Migrationen liegen als .sql-Dateien daneben und werden nicht kompiliert.
# `dist/db/migrate.js` löst den Ordner relativ zur eigenen Datei auf, deshalb
# muss er auf derselben Ebene wie `dist` liegen.
COPY apps/backend/drizzle ./apps/backend/drizzle

# Das Node-Basisimage bringt den unprivilegierten Benutzer `node` bereits mit.
USER node

EXPOSE 4000

# Kein Healthcheck hier: den definiert docker-compose, damit er zur jeweiligen
# Umgebung passt und nicht im Image festgeschrieben ist.
CMD ["node", "apps/backend/dist/index.js"]
