# Multi-stage build for apt-mirror with nginx
FROM ubuntu:22.04 as base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    apt-mirror \
    nginx \
    openssl \
    curl \
    wget \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Create necessary directories
RUN mkdir -p /var/spool/apt-mirror \
    && mkdir -p /var/www/mirror.intra \
    && mkdir -p /var/www/admin.mirror.intra \
    && mkdir -p /var/www/files.mirror.intra \
    && mkdir -p /etc/nginx/sites-available \
    && mkdir -p /etc/nginx/sites-enabled

# Copy scripts
COPY scripts/ /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh

# Create symlink for apt-mirror data
RUN ln -sf /var/spool/apt-mirror/mirror /var/www/mirror.intra/mirror

# Expose ports
EXPOSE 80 443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost/ || exit 1

# Start script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
