# Sentinel Lab Image — pre-baked sandbox base
#
# Build modes:
#   A) Local Docker:      docker build -t <registry>/sentinel-lab:latest .
#                         docker push <registry>/sentinel-lab:latest
#   B) Daytona declarative builder (if enabled on your account):
#                         daytona snapshot create --dockerfile ./Dockerfile --name sentinel-lab
#
# Contents mirror sandbox-setup/lib.sh bootstrap so missions skip all
# runtime installation when this image backs the sandbox.

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget git unzip xz-utils \
      nodejs npm \
      python3 python3-pip \
      php-cli php-mysqli php-gd \
      mariadb-server mariadb-client \
      nmap sqlmap \
      iputils-ping net-tools procps psmisc \
      default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# Python security tooling
RUN pip3 install --break-system-packages --quiet \
      binwalk capstone pyelftools requests || \
    pip3 install --quiet binwalk capstone pyelftools requests

# Marker consumed by sandbox-setup/lib.sh: presence => skip all bootstrapping
RUN mkdir -p /opt/sentinel-lab && touch /opt/sentinel-lab/.prebaked

# Non-root operator user (best-effort; some tools still need root)
RUN useradd -ms /bin/bash operator || true

WORKDIR /workspace
CMD ["sleep", "infinity"]
