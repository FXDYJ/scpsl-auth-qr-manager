FROM node:22-alpine AS scanner
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY scripts/ scripts/
COPY public/ public/
RUN npm run build

FROM php:8.4-fpm-alpine AS php
WORKDIR /app
COPY src/ src/
COPY public/api/ public/api/
COPY public/assets/trust/ public/assets/trust/
RUN install -d -m 0700 -o www-data -g www-data /var/cache/auth-qr
ENV SCPSL_QR_KEY_CACHE=/var/cache/auth-qr

FROM nginxinc/nginx-unprivileged:stable-alpine AS nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /app/public/
COPY --from=scanner /build/public/vendor/ /app/public/vendor/
COPY --from=scanner /build/public/sw.js /app/public/sw.js
