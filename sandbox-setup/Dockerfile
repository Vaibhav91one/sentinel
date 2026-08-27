# Sentinel Lab Image — pre-baked sandbox base
#
# Build modes:
#   A) Local Docker:      docker build -t <registry>/sentinel-lab:latest .
#                         docker push <registry>/sentinel-lab:latest
#   B) Daytona declarative builder (if enabled on your account):
#                         daytona snapshot create --dockerfile ./Dockerfile --name sentinel-lab
#
# Contents mirror sandbox-setup/lib.sh bootstrap so missions skip all
# runtime installation when this image backs the sandbox. Target arch is
# linux/amd64 (Daytona cloud); go install + Java tools keep it arch-agnostic.

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV GOPATH=/root/go
# GOBIN on the default PATH so go-installed tools resolve in login shells and
# for the non-root operator user (who cannot traverse /root/go/bin).
ENV GOBIN=/usr/local/bin
ENV PATH=/usr/local/go/bin:$PATH

# --- Base runtimes + lab-app deps + web recon tools packaged by Debian ---
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget git unzip xz-utils jq \
      nodejs npm \
      python3 python3-pip python3-venv \
      php-cli php-mysqli php-gd \
      mariadb-server mariadb-client \
      nmap sqlmap perl \
      squashfs-tools cpio \
      iputils-ping net-tools procps psmisc \
      default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# --- Python security tooling (web params/XSS, mobile static, firmware) ---
RUN pip3 install --break-system-packages --quiet \
      binwalk capstone pyelftools requests \
      wfuzz arjun \
      androguard apkleaks mobsfscan \
    || pip3 install --quiet \
      binwalk capstone pyelftools requests wfuzz arjun androguard apkleaks mobsfscan
# unblob (modern binwalk alt) has heavy native extractors — best-effort only
RUN pip3 install --break-system-packages --quiet unblob || true

# --- Modern Go toolchain (Debian's golang-go is 1.19, too old for nuclei v3) ---
RUN ARCH=$(dpkg --print-architecture) \
 && wget -q "https://go.dev/dl/go1.23.4.linux-${ARCH}.tar.gz" -O /tmp/go.tgz \
 && tar -C /usr/local -xzf /tmp/go.tgz && rm /tmp/go.tgz \
 && go version

# --- Go release binaries: ProjectDiscovery + web-fuzzing/XSS toolchain ---
# Pinned versions; go install is arch-agnostic (no per-tool release-arch juggling).
RUN go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@v3.3.0 \
 && go install github.com/ffuf/ffuf/v2@v2.1.0 \
 && go install github.com/OJ/gobuster/v3@v3.8.2 \
 && go install github.com/projectdiscovery/httpx/cmd/httpx@v1.6.0 \
 && go install github.com/hahwul/dalfox/v2@v2.9.0 \
 && rm -rf /root/go/pkg /root/.cache/go-build
# seed nuclei templates so first run is offline-ready
RUN nuclei -update-templates || true

# --- Git-sourced tools: jwt_tool (JWT attacks), testssl.sh (TLS), firmwalker ---
RUN git clone --depth 1 https://github.com/ticarpi/jwt_tool /opt/jwt_tool \
 && pip3 install --break-system-packages -r /opt/jwt_tool/requirements.txt 2>/dev/null \
    || pip3 install -r /opt/jwt_tool/requirements.txt 2>/dev/null || true \
 && printf '#!/bin/sh\nexec python3 /opt/jwt_tool/jwt_tool.py "$@"\n' > /usr/local/bin/jwt_tool \
 && chmod +x /usr/local/bin/jwt_tool \
 && git clone --depth 1 https://github.com/drwetter/testssl.sh /opt/testssl.sh \
 && ln -s /opt/testssl.sh/testssl.sh /usr/local/bin/testssl.sh \
 && git clone --depth 1 https://github.com/craigz28/firmwalker /opt/firmwalker \
 && ln -s /opt/firmwalker/firmwalker.sh /usr/local/bin/firmwalker \
 && git clone --depth 1 https://github.com/sullo/nikto /opt/nikto \
 && printf '#!/bin/sh\nexec perl /opt/nikto/program/nikto.pl "$@"\n' > /usr/local/bin/nikto \
 && chmod +x /usr/local/bin/nikto

# --- Mobile: jadx (decompiler) + apktool (resource decode), both JVM/arch-agnostic ---
RUN wget -q https://github.com/skylot/jadx/releases/download/v1.5.0/jadx-1.5.0.zip -O /tmp/jadx.zip \
 && unzip -q /tmp/jadx.zip -d /opt/jadx && rm /tmp/jadx.zip \
 && ln -s /opt/jadx/bin/jadx /usr/local/bin/jadx \
 && ln -s /opt/jadx/bin/jadx-gui /usr/local/bin/jadx-gui 2>/dev/null || true \
 && wget -q https://raw.githubusercontent.com/iBotPeaches/Apktool/master/scripts/linux/apktool -O /usr/local/bin/apktool \
 && wget -q https://github.com/iBotPeaches/Apktool/releases/download/v2.9.3/apktool_2.9.3.jar -O /usr/local/bin/apktool.jar \
 && chmod +x /usr/local/bin/apktool

# Marker consumed by sandbox-setup/lib.sh: presence => skip all bootstrapping
RUN mkdir -p /opt/sentinel-lab && touch /opt/sentinel-lab/.prebaked

# Non-root operator user (best-effort; some tools still need root)
RUN useradd -ms /bin/bash operator || true

WORKDIR /workspace
CMD ["sleep", "infinity"]
