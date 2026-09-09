# Mareo gateway image.
# Stage 1 builds the TypeScript output and keeps only production dependencies
# (nodemailer for verification emails) alongside it.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci
RUN npx tsc -p tsconfig.json
RUN npm prune --omit=dev

# Stage 2 runtime: node:sqlite covers storage; production node_modules is
# copied in so nodemailer resolves at boot.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "dist/src/main.js"]
