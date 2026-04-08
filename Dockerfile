# Based on https://github.com/openshift/console-plugin-template (upstream); source: https://github.com/albertofilice/managed-operators-plugin
# The runtime image serves static files over HTTP (port 80). On-cluster, the Helm chart
# mounts nginx config with TLS and serving certs (default port 9443).
FROM --platform=linux/amd64 registry.access.redhat.com/ubi9/nodejs-22:latest AS build
USER root
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Yarn is provided via Corepack (bundled with Node), matching `package.json` → `packageManager: "yarn@4.x"`.
RUN npm i -g corepack && corepack enable

ADD . /usr/src/app
WORKDIR /usr/src/app
RUN yarn install --immutable && yarn build

FROM --platform=linux/amd64 registry.access.redhat.com/ubi9/nginx-120:latest

COPY --from=build /usr/src/app/dist /usr/share/nginx/html
USER 1001

ENTRYPOINT ["nginx", "-g", "daemon off;"]
