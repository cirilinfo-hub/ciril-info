# Angular build → static files baked into the Nginx edge image.
# Build context: repository root (ciril-info-saas/).
# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS build
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
RUN npx ng build --configuration production

FROM nginx:1.28-alpine AS runtime
RUN rm -f /etc/nginx/conf.d/default.conf
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/conf.d/ /etc/nginx/conf.d/
COPY infra/nginx/snippets/ /etc/nginx/snippets/
COPY --from=build /app/dist/web/browser /usr/share/nginx/html
EXPOSE 80 443
