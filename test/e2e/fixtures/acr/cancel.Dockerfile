FROM busybox:1.37.0
RUN echo REST29_CANCEL_READY && sleep 300
CMD ["/bin/true"]
