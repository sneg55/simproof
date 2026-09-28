FROM node@sha256:a723b54c35a76e947095a20a67d39585bb09c862e6b1adeb8a9f518f95e34fb0 AS node-runtime

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
