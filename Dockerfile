FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PORT=3000

# Install ALL deps (including Tailwind/TypeScript) for the Next build.
# Do not set NODE_ENV=production before npm ci — that skips devDependencies.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000
CMD ["sh", "-c", "npx next start --hostname 0.0.0.0 --port ${PORT:-3000}"]
