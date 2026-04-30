ARG BASE_IMAGE=debian:bookworm

FROM ${BASE_IMAGE}

ARG LINUX_TARGET_TRIPLE=x86_64-unknown-linux-gnu
ARG RUST_TOOLCHAIN=1.95.0

ENV DEBIAN_FRONTEND=noninteractive
ENV RUSTUP_HOME=/opt/rust/rustup
ENV CARGO_HOME=/opt/rust/cargo
ENV PATH=/opt/rust/cargo/bin:$PATH
ENV CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        gcc-x86-64-linux-gnu \
        libc6-dev-amd64-cross \
        nodejs \
        npm \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --profile minimal --default-toolchain "${RUST_TOOLCHAIN}" --target "${LINUX_TARGET_TRIPLE}" \
    && chmod -R a+rX /opt/rust
