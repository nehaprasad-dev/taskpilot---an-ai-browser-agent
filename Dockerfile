FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["sh", "-c", "npx next start --hostname 0.0.0.0 --port ${PORT:-3000}"]
