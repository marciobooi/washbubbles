# Build context is the repo root (see docker-compose.yml).
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
# Deliberately NOT setting VITE_API_URL/VITE_HW_BRIDGE_URL: the frontend
# falls back to same-origin relative paths, which is exactly what the nginx
# reverse proxy in this compose stack provides.
ARG VITE_KIOSK_API_KEY=
ENV VITE_KIOSK_API_KEY=$VITE_KIOSK_API_KEY
ARG VITE_PUBLIC_SITE=
ENV VITE_PUBLIC_SITE=$VITE_PUBLIC_SITE
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/csp-spa-report-only.conf /etc/nginx/snippets/csp-spa-report-only.conf
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
