# Build stage: the server is bundled together with the shared protocol package,
# which is what guarantees client and server speak the identical wire format.
FROM node:22-alpine AS build

WORKDIR /build

# The build context is the repository root, because the server depends on the
# protocol workspace next to it.
COPY package.json package-lock.json ./
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/server/package.json ./packages/server/
RUN npm ci --ignore-scripts

COPY packages/protocol ./packages/protocol
COPY packages/server ./packages/server

WORKDIR /build/packages/server
RUN node build.mjs

# Runtime stage: one JavaScript file and nothing else. No node_modules, no
# framework, nothing to keep patched on a machine that holds someone's notes.
FROM node:22-alpine

RUN addgroup -S toolbox && adduser -S toolbox -G toolbox

WORKDIR /app
COPY --from=build /build/packages/server/dist/server.js ./server.js

# The data directory is a volume; ownership matters because the process is not root.
RUN mkdir -p /data && chown -R toolbox:toolbox /data
VOLUME /data

USER toolbox
ENV TOOLBOX_DATA_DIR=/data
ENV TOOLBOX_PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.TOOLBOX_PORT||8787)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
