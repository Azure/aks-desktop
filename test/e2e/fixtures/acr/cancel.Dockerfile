FROM mcr.microsoft.com/azurelinux/base/core:3.0@sha256:a333b3233076d8b47d63237760e7b36576c0fe47fbf670d5d3517d2fd6fe5030
RUN echo REST29_CANCEL_READY && sleep 300
CMD ["true"]
