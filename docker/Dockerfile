FROM registry.access.redhat.com/ubi9/ubi

LABEL org.opencontainers.image.title="rh-ca-lab"       org.opencontainers.image.authors="Your Name <you@example.com>"       org.opencontainers.image.vendor="Example Org"

RUN dnf -y install ca-certificates openssl curl-minimal     && update-ca-trust extract     && dnf clean all

WORKDIR /work

CMD ["bash"]
