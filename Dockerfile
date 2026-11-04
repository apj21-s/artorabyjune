# Artora by June — production image
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY views ./views

# Local uploads (only used when Cloudinary isn't connected and ALLOW_LOCAL_UPLOADS is set)
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health || exit 1
CMD ["node", "server/index.js"]
