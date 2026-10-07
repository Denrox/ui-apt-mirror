# Multi-stage build for apt-mirror with nginx
FROM ubuntu:24.04 AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    nginx \
    openssl \
    curl \
    wget \
    nodejs \
    npm \
    xz-utils \
    net-tools \
    bzip2 \
    gzip \
    unzip \
    ca-certificates \
    tzdata \
    bc \
    gnupg \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install skopeo for container image operations
RUN apt-get update && apt-get install -y \
    skopeo \
    && rm -rf /var/lib/apt/lists/*

# Install apt-mirror2 from PyPI (using --break-system-packages for Ubuntu 24.04).
# Pinned: scripts/apt-mirror-signed.py relies on its internals; retest signing before bumping.
RUN pip3 install --break-system-packages apt-mirror==16 uvloop

# Create necessary directories
RUN mkdir -p /var/spool/apt-mirror \
    && mkdir -p /var/www/mirror.intra \
    && mkdir -p /var/www/admin.mirror.intra \
    && mkdir -p /var/www/files \
    && mkdir -p /etc/nginx/sites-available \
    && mkdir -p /etc/nginx/sites-enabled \
    && mkdir -p /var/log/apt-mirror

COPY admin/ /var/admin
COPY admin/app/config/config.build.json /var/admin/app/config/config.json
RUN cd /var/admin && npm install && npm run build

# Nginx site templates, rendered by entrypoint.sh
COPY nginx/sites/ /etc/nginx/templates/
COPY nginx/conf.d/ /etc/nginx/conf.d/
COPY nginx/sites-setup/render-sites.sh nginx/sites-setup/released-sites.sha256 /etc/nginx/sites-setup/

# Copy scripts
COPY scripts/ /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh

# Create symlink for apt-mirror data
RUN ln -sf /var/spool/apt-mirror/mirror /var/www/mirror.intra/mirror

# Expose ports
EXPOSE 80 443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD /usr/local/bin/health-check.sh once

# Start script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
