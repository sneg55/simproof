FROM node@sha256:e961046fec20896e8904f2b4a8b4c7e5ca91826d84d8d33d83dbaa61f942069e AS node-runtime

RUN mkdir -p /rootfs/usr/local/bin \
    && cp /usr/local/bin/node /rootfs/usr/local/bin/node \
    && ldd /usr/local/bin/node \
      | awk '/=> \// { print $3 } $1 ~ /^\// { print $1 }' \
      | sort -u \
      | xargs -r -I '{}' cp -L --parents '{}' /rootfs

FROM scratch

COPY --from=node-runtime /rootfs /
COPY --chown=65532:65532 apps/runner/runtime/entrypoint.mjs /runner/entrypoint.mjs

WORKDIR /work
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/node", "--disallow-code-generation-from-strings", "--permission", "--allow-fs-read=/work/*", "--allow-fs-write=/work/*", "/runner/entrypoint.mjs"]
