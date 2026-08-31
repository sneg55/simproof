FROM node@sha256:f5d1cc40abc10c2843339a2134d07817cf33c405cb16bfd052b0ed790254c3a3 AS node-runtime

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
