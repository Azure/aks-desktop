FROM mcr.microsoft.com/azurelinux/base/core:3.0 AS verified
ARG E2E_MARKER
COPY . /context/
RUN set -eux; \
    test "$(tr -d '\r' < /context/included.txt)" = "nested-context-marker" \
    && test -n "$E2E_MARKER" \
    && test "$E2E_MARKER" = "$(cat /context/ignored/keep.txt)" \
    && test "$(sha256sum < /context/.dockerignore)" = "$(sha256sum < /context/expected-root-ignore.txt)" \
    && test ! -e /context/ignored.txt \
    && test ! -e /context/ignored/drop.txt \
    && test ! -e /context/outside-context.txt \
    && test ! -e /context/.aksd-acr \
    && test ! -e /context/.aksd-acr.Dockerfile \
    && test ! -e /context/.aksd-acr.Dockerfile.dockerignore \
    && printf 'ACR_E2E_SOURCE_OK:%s\n' "$E2E_MARKER"

FROM scratch
ARG E2E_MARKER
LABEL aksd.e2e.marker=$E2E_MARKER
COPY --from=verified /context/ /context/
CMD ["/not-executed"]
