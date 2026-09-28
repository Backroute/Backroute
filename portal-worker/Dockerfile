# The browser worker, with the Chromium build that matches playwright-core (see package.json).
FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY worker.mjs ./
ENV NODE_ENV=production
# Runs as the image's unprivileged user.
USER pwuser
EXPOSE 8081
CMD ["node", "worker.mjs"]
