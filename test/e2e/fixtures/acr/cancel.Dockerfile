FROM mcr.microsoft.com/azurelinux/base/core:3.0
RUN echo REST29_CANCEL_READY && sleep 300
CMD ["true"]
