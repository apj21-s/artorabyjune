# Artora by June — production image
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY server ./server
COPY public ./public
COPY views ./views
COPY tools/vendor-tesseract.js ./tools/vendor-tesseract.js
# The on-device screenshot reader used on the payment page (copied from node_modules).
RUN node tools/vendor-tesseract.js

# Local uploads (only used when Cloudinary isn't connected and ALLOW_LOCAL_UPLOADS is set).
# Payment screenshots go to private_uploads, which is never served publicly.
RUN mkdir -p /app/uploads /app/private_uploads && chown node:node /app/uploads /app/private_uploads
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health || exit 1
CMD ["node", "server/index.js"]
