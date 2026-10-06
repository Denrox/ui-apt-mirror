#!/bin/bash

# Startup script for ui-apt-mirror
# This script handles the deployment and configuration of the apt-mirror container

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="ui-apt-mirror"
CONTAINER_NAME="ui-apt-mirror"
DIST_DIR="dist"
ENV_FILE=".env"
COMPOSE_HAND_EDITED=""
COMPOSE_HASH_FILE=".docker-compose.yml.sha256"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to verify required commands are installed
require_cmd() {
    local missing=()
    for cmd in "$@"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing+=("$cmd")
        fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        print_error "Missing required command(s): ${missing[*]}"
        print_error "Install them and re-run this script."
        case " ${missing[*]} " in
            *" docker "*)        print_error "  docker:  https://docs.docker.com/engine/install/" ;;
        esac
        case " ${missing[*]} " in
            *" openssl "*)       print_error "  openssl: sudo apt-get install -y openssl" ;;
        esac
        case " ${missing[*]} " in
            *" free "*)          print_error "  free:    sudo apt-get install -y procps" ;;
        esac
        case " ${missing[*]} " in
            *" curl "*)          print_error "  curl:    sudo apt-get install -y curl" ;;
        esac
        case " ${missing[*]} " in
            *" tar "*|*" gunzip "*) print_error "  tar/gunzip: sudo apt-get install -y tar gzip" ;;
        esac
        exit 1
    fi
}

# Function to verify Docker Compose v2 plugin is available
require_docker_compose() {
    if ! docker compose version >/dev/null 2>&1; then
        print_error "Docker Compose v2 plugin not found."
        print_error "Install it: https://docs.docker.com/compose/install/linux/"
        print_error "(legacy 'docker-compose' v1 is not supported by this script)"
        exit 1
    fi
}

# Function to detect system architecture
detect_architecture() {
    print_status "Detecting system architecture..." >&2
    
    local arch=$(uname -m)
    case $arch in
        x86_64)
            echo "amd64"
            ;;
        aarch64|arm64)
            echo "arm64"
            ;;
        *)
            print_error "Unsupported architecture: $arch"
            exit 1
            ;;
    esac
}

# Function to calculate optimal threads and connections based on RAM
calculate_resource_limits() {
    print_status "Calculating optimal resource limits based on available RAM..."
    
    # Get total RAM in KB and convert to MB (fix for ARM64/OpenWrt)
    local total_ram_kb=$(free | awk 'NR==2{print $2}')
    local total_ram_mb=$((total_ram_kb / 1024))
    
    print_status "Total RAM detected: ${total_ram_mb}MB"
    
    # Calculate threads: 1 thread per 700MB RAM
    local calculated_threads=$((total_ram_mb / 700))
    
    # Ensure minimum of 1 thread and maximum of 4 threads
    if [ $calculated_threads -lt 1 ]; then
        calculated_threads=1
    elif [ $calculated_threads -gt 4 ]; then
        calculated_threads=4
    fi

    # Calculate connections: 6 connections per 700MB RAM
    local calculated_connections=$((6 * (total_ram_mb / 700)))

    # Ensure minimum of 6 connections and maximum of 16 connections
    if [ $calculated_connections -lt 6 ]; then
        calculated_connections=6
    elif [ $calculated_connections -gt 16 ]; then
        calculated_connections=16
    fi
    
    print_success "Calculated optimal settings:"
    print_success "  - Threads: $calculated_threads (1 per 700MB RAM)"
    print_success "  - Connections: $calculated_connections (6 per 700MB RAM)"
    
    # Set global variables
    OPTIMAL_THREADS=$calculated_threads
    OPTIMAL_CONNECTIONS=$calculated_connections
}

# Function to validate dist directory
validate_dist() {
    local arch=$1
    local tar_file="${DIST_DIR}/${IMAGE_NAME}-${arch}.tar.gz"
    
    print_status "Validating distribution files..."
    
    if [ ! -d "$DIST_DIR" ]; then
        print_error "Distribution directory '$DIST_DIR' not found."
        print_error "Please run ./build.sh first to build the images."
        exit 1
    fi
    
    if [ ! -f "$tar_file" ]; then
        print_error "Image file '$tar_file' not found."
        print_error "Please run ./build.sh first to build the images."
        exit 1
    fi
    
    print_success "Found image file: $tar_file"
}

# Settings live in .env (read by docker compose); upgrades never touch it.

# Read KEY from a KEY=VALUE file without sourcing it
env_get() {
    grep -E "^$1=" "$2" 2>/dev/null | tail -n 1 | cut -d= -f2-
}

# Read "- KEY=value" from a pre-.env docker-compose.yml
compose_get() {
    local value
    value=$(grep -E "^[[:space:]]*-[[:space:]]*$1=" "$2" 2>/dev/null | head -n 1 | sed -E "s/^[[:space:]]*-[[:space:]]*$1=//")
    case "$value" in
        *'${'*) echo "" ;;
        *) echo "$value" ;;
    esac
}

# Function to load the current settings, if any
load_existing_config() {
    INSTALL_EXISTS=false
    CONFIG_SOURCE=""
    CUR_DOMAIN=""
    CUR_SYNC=""
    CUR_TZ=""
    CUR_NPM=""

    if [ -f "$ENV_FILE" ]; then
        CONFIG_SOURCE="$ENV_FILE"
        CUR_DOMAIN=$(env_get MIRROR_DOMAIN "$ENV_FILE")
        CUR_SYNC=$(env_get SYNC_FREQUENCY "$ENV_FILE")
        CUR_TZ=$(env_get TZ "$ENV_FILE")
        CUR_NPM=$(env_get NPM_PROXY_ENABLED "$ENV_FILE")
    elif [ -f "docker-compose.yml" ]; then
        CONFIG_SOURCE="docker-compose.yml"
        CUR_DOMAIN=$(compose_get MIRROR_DOMAIN docker-compose.yml)
        CUR_SYNC=$(compose_get SYNC_FREQUENCY docker-compose.yml)
        CUR_TZ=$(compose_get TZ docker-compose.yml)
        CUR_NPM=$(compose_get NPM_PROXY_ENABLED docker-compose.yml)
    fi

    if [ -n "$CONFIG_SOURCE" ] || [ -s data/auth/.htpasswd ]; then
        INSTALL_EXISTS=true
    fi
}

use_current_config() {
    local host_timezone
    host_timezone=$(timedatectl show --property=Timezone --value 2>/dev/null || echo "UTC")
    MIRROR_DOMAIN="${CUR_DOMAIN:-mirror.intra}"
    SYNC_FREQUENCY="${CUR_SYNC:-14400}"
    HOST_TIMEZONE="${CUR_TZ:-$host_timezone}"
    # Unset means enabled: before NPM_PROXY_ENABLED existed the proxy was always on.
    if [ "$CUR_NPM" = "false" ]; then ENABLE_NPM_PROXY="n"; else ENABLE_NPM_PROXY="y"; fi
}

show_current_config() {
    echo ""
    echo "Current settings (from $CONFIG_SOURCE):"
    echo "  Domain:         $MIRROR_DOMAIN"
    echo "  Sync frequency: every $((SYNC_FREQUENCY / 3600)) hours ($SYNC_FREQUENCY s)"
    echo "  Timezone:       $HOST_TIMEZONE"
    echo "  npm proxy:      $([ "$ENABLE_NPM_PROXY" = "y" ] && echo enabled || echo disabled)"
}

# Function to ask for every setting, defaulting to the current values
prompt_user_config() {
    print_status "Getting user configuration..."

    echo ""
    read -p "Enter your custom domain (default: $MIRROR_DOMAIN): " custom_domain
    MIRROR_DOMAIN=${custom_domain:-$MIRROR_DOMAIN}

    local current_choice=""
    case $SYNC_FREQUENCY in
        14400) current_choice=1 ;;
        43200) current_choice=2 ;;
        86400) current_choice=3 ;;
    esac
    echo ""
    echo "Sync frequency options:"
    echo "  1. Every 4 hours"
    echo "  2. Every 12 hours"
    echo "  3. Every 24 hours"
    read -p "Select sync frequency (1-3, Enter keeps current: every $((SYNC_FREQUENCY / 3600)) hours): " sync_choice
    case ${sync_choice:-keep} in
        1) SYNC_FREQUENCY="14400" ;;
        2) SYNC_FREQUENCY="43200" ;;
        3) SYNC_FREQUENCY="86400" ;;
        keep) ;;
        *) print_error "Invalid choice. Keeping the current value." ;;
    esac

    echo ""
    echo "NPM Proxy Configuration:"
    echo "  The npm proxy provides a local caching proxy for npm packages."
    echo "  This can speed up npm installs and reduce bandwidth usage."
    local npm_hint="Y/n"
    [ "$ENABLE_NPM_PROXY" = "y" ] || npm_hint="y/N"
    read -p "Do you need a caching npm proxy? ($npm_hint): " enable_npm_proxy
    case ${enable_npm_proxy:-keep} in
        y|Y) ENABLE_NPM_PROXY="y" ;;
        n|N) ENABLE_NPM_PROXY="n" ;;
    esac

    echo ""
    read -p "Enter timezone (default: $HOST_TIMEZONE): " custom_timezone
    HOST_TIMEZONE=${custom_timezone:-$HOST_TIMEZONE}

    print_success "Configuration completed."
}

prompt_admin_password() {
    local default_admin_pass="admin"
    echo ""
    read -s -p "Enter admin password (default: $default_admin_pass): " admin_pass
    echo ""
    ADMIN_PASSWORD=${admin_pass:-$default_admin_pass}
}

resolve_user_config() {
    local mode=$1
    use_current_config

    if [ "$INSTALL_EXISTS" = false ]; then
        prompt_user_config
        return
    fi

    if [ "$mode" = "reconfigure" ]; then
        prompt_user_config
        return
    fi

    if [ -z "$CONFIG_SOURCE" ]; then
        print_warning "Existing install found but no saved settings; using defaults."
    else
        show_current_config
    fi

    if [ "$mode" = "upgrade" ]; then
        print_status "Keeping current settings (run ./setup.sh --reconfigure to change them)."
        return
    fi

    echo ""
    read -p "Keep these settings? (Y/n): " keep_settings
    case ${keep_settings:-y} in
        n|N) prompt_user_config ;;
        *) print_status "Keeping current settings." ;;
    esac
}

write_env_file() {
    local npm_enabled="false"
    [ "$ENABLE_NPM_PROXY" = "y" ] && npm_enabled="true"

    print_status "Saving settings to $ENV_FILE..."
    cat > "$ENV_FILE" <<ENVEOF
# ui-apt-mirror settings. Change with ./setup.sh --reconfigure, or edit and run ./start.sh.
MIRROR_DOMAIN=$MIRROR_DOMAIN
ADMIN_DOMAIN=admin.$MIRROR_DOMAIN
FILES_DOMAIN=files.$MIRROR_DOMAIN
NPM_DOMAIN=npm.$MIRROR_DOMAIN
CHEATSHEETS_DOMAIN=cheatsheets.$MIRROR_DOMAIN
SYNC_FREQUENCY=$SYNC_FREQUENCY
NPM_PROXY_ENABLED=$npm_enabled
TZ=$HOST_TIMEZONE
ENVEOF
    print_success "Settings saved."
}


generate_htpasswd() {
    local admin_pass=$1
    
    print_status "Generating htpasswd file..."
    
    mkdir -p data/auth
    
    # Generate SHA-512 hash using openssl
    local pass_hash
    pass_hash=$(printf '%s' "$admin_pass" | openssl passwd -6 -stdin)
    if [ -z "$pass_hash" ]; then
        print_error "openssl produced an empty password hash."
        exit 1
    fi
    # Keep the other users
    local htpasswd=data/auth/.htpasswd
    local others=""
    [ -f "$htpasswd" ] && others=$(grep -v '^admin:' "$htpasswd" || true)
    local old_umask
    old_umask=$(umask)
    umask 077
    rm -f "$htpasswd.tmp"
    {
        echo "admin:$pass_hash"
        [ -n "$others" ] && echo "$others"
    } > "$htpasswd.tmp"
    umask "$old_umask"
    chmod 600 "$htpasswd.tmp"
    chown --reference=data/auth "$htpasswd.tmp" 2>/dev/null || true
    mv "$htpasswd.tmp" "$htpasswd"

    # Revokes admin sessions and npm tokens issued with the old password
    local revoked=data/auth/.tokens-valid-after
    (umask 077; echo "admin $(date +%s)000" >> "$revoked")
    chown --reference=data/auth "$revoked" 2>/dev/null || true

    print_success "htpasswd file generated successfully."
}


# Same backup as upgrade.sh; old upgrade.sh versions have none
backup_config() {
    local items=()
    local item
    for item in .env docker-compose.yml docker-compose.override.yml data/conf data/auth; do
        [ -e "$item" ] && items+=("$item")
    done
    if [ ${#items[@]} -eq 0 ]; then
        return
    fi

    mkdir -p backups
    local backup="backups/pre-upgrade-$(date +%Y%m%d-%H%M%S).tar.gz"
    print_status "Backing up configuration to $backup..."
    local skipped
    if skipped=$(umask 077; tar -czf "$backup" --ignore-failed-read "${items[@]}" 2>&1 >/dev/null); then
        chmod 600 "$backup"
        if [ -n "$skipped" ]; then
            print_warning "Some files could not be read and are not in the backup:"
            echo "$skipped" | sed 's/^/  /'
        fi
        print_success "Backup saved: $backup"
    else
        [ -n "$skipped" ] && echo "$skipped"
        print_error "Backup failed; aborting before anything is changed."
        exit 1
    fi
}

# Fingerprints of every released docker-compose.src.yml with values blanked;
# a pre-.env docker-compose.yml matching one was never edited by hand.
LEGACY_COMPOSE_FINGERPRINTS="24a1f8ce60550fc1 1a5fddfd8e7c4736 bdd1748a8142e672 67213f824f6d9873 2cabb2f42d493772 830e2a450d30f66d c5ed624d685be465 7fcfd9624207e48d 6d21328162dc297d 8f8e4cf1bb2e2fbb 8311e9dc94b89163"

compose_fingerprint() {
    sed -E 's/^([[:space:]]*-[[:space:]]*)([A-Z_]+)=.*/\1\2=/' "$1" \
        | sed -E 's/[[:space:]]+$//' | sha256sum | cut -c1-16
}

install_docker_compose() {
    if [ "$CONFIG_SOURCE" = "docker-compose.yml" ]; then
        mkdir -p backups
        local backup="backups/docker-compose.yml.before-env-$(date +%Y%m%d%H%M%S)"
        cp docker-compose.yml "$backup"
        local fingerprint
        fingerprint=$(compose_fingerprint docker-compose.yml)
        case " $LEGACY_COMPOSE_FINGERPRINTS " in
            *" $fingerprint "*)
                print_status "docker-compose.yml settings moved to $ENV_FILE (previous file: $backup)."
                ;;
            *)
                COMPOSE_HAND_EDITED="$backup"
                print_warning "Your docker-compose.yml had hand edits (ports, volumes...)."
                print_warning "It is saved as $backup."
                print_warning "Move those edits to docker-compose.override.yml; upgrades never touch that file."
                ;;
        esac
    fi

    # Differs from the file we installed last time: hand edits
    if [ "$CONFIG_SOURCE" = "$ENV_FILE" ] && [ -f docker-compose.yml ]; then
        local recorded current
        recorded=$(cat "$COMPOSE_HASH_FILE" 2>/dev/null || true)
        current=$(sha256sum docker-compose.yml | cut -d' ' -f1)
        if [ "$current" != "$recorded" ] && ! cmp -s docker-compose.yml docker-compose.src.yml; then
            mkdir -p backups
            local edited="backups/docker-compose.yml.edited-$(date +%Y%m%d%H%M%S)"
            cp docker-compose.yml "$edited"
            COMPOSE_HAND_EDITED="$edited"
            print_warning "docker-compose.yml was changed by hand; saved as $edited."
            print_warning "Move those edits to docker-compose.override.yml; upgrades never touch that file."
        fi
    fi

    print_status "Installing docker-compose.yml..."
    cp docker-compose.src.yml docker-compose.yml
    sha256sum docker-compose.yml | cut -d' ' -f1 > "$COMPOSE_HASH_FILE"
    print_success "docker-compose.yml installed."
}

# Older versions had no volume for private files; copy them out before the container goes
preserve_private_files() {
    if ! docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
        return
    fi
    if docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "$CONTAINER_NAME" \
        | grep -qx "/var/www/files-private"; then
        return
    fi

    print_status "Copying private files out of the existing container..."
    mkdir -p data/data/files-private
    if docker cp "$CONTAINER_NAME:/var/www/files-private/." data/data/files-private/ >/dev/null 2>&1; then
        local count
        count=$(find data/data/files-private -type f | wc -l)
        print_success "Private files saved to data/data/files-private ($count files)."
    else
        print_status "No private files found in the existing container."
    fi
}

# Function to clean up previous installation
cleanup_previous() {
    print_status "Cleaning up previous installation..."
    
    # Stop and remove existing container
    if docker ps -a --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        print_status "Stopping existing container..."
        docker stop "$CONTAINER_NAME" 2>/dev/null || true
        print_status "Removing existing container..."
        docker rm "$CONTAINER_NAME" 2>/dev/null || true
    fi
    
    # Remove existing images
    if docker images --format "table {{.Repository}}" | grep -q "^${IMAGE_NAME}$"; then
        print_status "Removing existing images..."
        docker rmi "$IMAGE_NAME:latest" 2>/dev/null || true
    fi
    
    print_success "Cleanup completed."
}

# Function to create data directories
create_data_dirs() {
    print_status "Creating data directories..."
    
    mkdir -p data/{data/apt-mirror,data/files,data/files-private,data/npm,data/cheatsheets,logs/apt-mirror,logs/nginx,conf/apt-mirror,conf/nginx/custom,auth}
    
    # Set proper permissions
    chmod 755 data/
    chmod 755 data/*
    # Password hashes: owner only
    [ -f data/auth/.htpasswd ] && chmod 600 data/auth/.htpasswd
    
    print_success "Data directories created."
}


# Older mirror.list files ran a postmirror script that was never shipped (an error on every
# sync) and so never ran clean.sh; let apt-mirror2 delete unneeded packages itself.
migrate_mirror_config() {
    local list=data/conf/apt-mirror/mirror.list
    grep -qE '^set[[:space:]]+run_postmirror[[:space:]]+1[[:space:]]*$' "$list" || return 0
    [ -e data/data/apt-mirror/var/postmirror.sh ] && return 0
    sed -i -E 's/^set([[:space:]]+)run_postmirror([[:space:]]+)1[[:space:]]*$/set\1run_postmirror\20/' "$list"
    if ! grep -qE '^set[[:space:]]+_autoclean[[:space:]]' "$list"; then
        sed -i -E '/^set[[:space:]]+run_postmirror[[:space:]]/a set _autoclean 1' "$list"
    fi
    print_status "mirror.list: turned off the missing postmirror script; old packages are now deleted after each sync."
}

# Function to generate apt-mirror2 configuration
generate_mirror_config() {
    local domain=$1
    
    print_status "Generating apt-mirror2 configuration..."
    
    cat > data/conf/apt-mirror/mirror.list << EOF
# apt-mirror2 configuration for $domain
# Generated on $(date)

# Repositories are shipped disabled: a full mirror needs hundreds of GB. Enable the ones you
# need in the admin panel (Repositories), then start a sync.

# Set base_path to the directory where you want to store the mirror
set base_path    /var/spool/apt-mirror

# Set mirror_path to the directory where you want to store the mirror
set mirror_path  \$base_path/mirror

# Set skel_path to the directory where you want to store the skeleton
set skel_path    \$base_path/skel

# Set var_path to the directory where you want to store the variable data
set var_path     \$base_path/var

# Set cleanscript to the script that cleans the mirror
set cleanscript  \$var_path/clean.sh

# Set defaultarch to the default architecture
set defaultarch  amd64

# Set postmirror_script to the script that runs after mirroring
set postmirror_script \$var_path/postmirror.sh

# Set run_postmirror to 1 to run the postmirror script
set run_postmirror 0

# Delete packages the mirrored indexes no longer list after each sync (skipped when a download failed)
set _autoclean 1

# Set nthreads to the number of threads to use (calculated based on RAM)
set nthreads     $OPTIMAL_THREADS

# Set _tilde to 1 to download tilde files
set _tilde 0

# Set timeout for downloads (in seconds)
set _timeout 300

# Set retry count for failed downloads
set _retry 3

# Set download speed limit (in bytes per second, 0 = unlimited)
set _limit_rate 16777216

# Set user agent for downloads
set _user_agent "apt-mirror2/14"

# Set number of connections per host (calculated based on RAM)
set _max_connections $OPTIMAL_CONNECTIONS

set release_files_retries 15

# ---start---Ubuntu Noble---
# Ubuntu 24.04 (Noble Numbat) repositories - AMD64 architecture
#deb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse
#deb http://archive.ubuntu.com/ubuntu noble-updates main restricted universe multiverse
#deb http://archive.ubuntu.com/ubuntu noble-security main restricted universe multiverse
#deb http://archive.ubuntu.com/ubuntu noble-backports main restricted universe multiverse
# Usage start
#Types: deb
#URIs: http://mirror.intra/archive.ubuntu.com/ubuntu
#Suites: noble noble-updates noble-security noble-backports
#Components: main restricted universe multiverse
#Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
# Usage end
# ---end---Ubuntu Noble---

# ---start---Debian Bookworm---
# Debian 12 (Bookworm) repositories - AMD64 and ARM64 architectures
#deb http://deb.debian.org/debian bookworm main contrib non-free non-free-firmware
#deb http://deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware
#deb http://security.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
#deb http://deb.debian.org/debian bookworm-backports main contrib non-free non-free-firmware

#deb-src http://deb.debian.org/debian bookworm main contrib non-free non-free-firmware
#deb-src http://deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware
#deb-src http://security.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
#deb-src http://deb.debian.org/debian bookworm-backports main contrib non-free non-free-firmware
# Usage start
#deb http://mirror.intra/deb.debian.org/debian bookworm main contrib non-free non-free-firmware
#deb http://mirror.intra/security.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
#deb http://mirror.intra/deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware
# Usage end
# ---end---Debian Bookworm---

# ---start---Debian Trixie---
# Debian 13 (Trixie) repositories - AMD64 and ARM64 architectures
#deb http://deb.debian.org/debian trixie main contrib non-free non-free-firmware
#deb http://deb.debian.org/debian trixie-updates main contrib non-free non-free-firmware
#deb http://security.debian.org/debian-security trixie-security main contrib non-free non-free-firmware
#deb http://deb.debian.org/debian trixie-backports main contrib non-free non-free-firmware

#deb-src http://deb.debian.org/debian trixie main contrib non-free non-free-firmware
#deb-src http://deb.debian.org/debian trixie-updates main contrib non-free non-free-firmware
#deb-src http://security.debian.org/debian-security trixie-security main contrib non-free non-free-firmware
#deb-src http://deb.debian.org/debian trixie-backports main contrib non-free non-free-firmware
# Usage start
#deb http://mirror.intra/deb.debian.org/debian trixie main contrib non-free non-free-firmware
#deb http://mirror.intra/security.debian.org/debian-security trixie-security main contrib non-free non-free-firmware
#deb http://mirror.intra/deb.debian.org/debian trixie-updates main contrib non-free non-free-firmware
#deb http://mirror.intra/deb.debian.org/debian trixie-backports main contrib non-free non-free-firmware
# Usage end
# ---end---Debian Trixie---

# ---start---Docker Ubuntu Noble---
# Docker CE for Ubuntu 24.04 (Noble Numbat) - AMD64 architecture
#deb https://download.docker.com/linux/ubuntu noble stable
# Usage start
#Types: deb
#URIs: http://mirror.intra/download.docker.com/linux/ubuntu
#Suites: noble
#Components: stable
#Trusted: yes
# Usage end
# ---end---Docker Ubuntu Noble---

# ---start---Docker Debian 13---
# Docker CE for Debian 13 (Trixie) - AMD64 architecture
#deb https://download.docker.com/linux/debian trixie stable
# Usage start
#deb [trusted=yes] http://mirror.intra/download.docker.com/linux/debian trixie stable
# Usage end
# ---end---Docker Debian 13---


# Clean up old packages
clean http://archive.ubuntu.com/ubuntu
clean http://deb.debian.org/debian
clean http://security.debian.org/debian-security
clean https://download.docker.com/linux/ubuntu
clean https://download.docker.com/linux/debian
EOF
    
    print_success "apt-mirror2 configuration generated with $OPTIMAL_THREADS threads and $OPTIMAL_CONNECTIONS connections."
}


# Function to show status
show_status() {
    print_status "Container status:"
    docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

    local domain
    domain=$(env_get MIRROR_DOMAIN "$ENV_FILE")
    domain=${domain:-mirror.intra}

    echo ""
    print_status "Access URLs:"
    echo "  Main Repository: http://$domain"
    echo "  Admin Panel: http://admin.$domain (admin/[password])"
    echo "  File Repository: http://files.$domain"
    echo "  Cheatsheets: http://cheatsheets.$domain"
    if [ "$(env_get NPM_PROXY_ENABLED "$ENV_FILE")" = "true" ]; then
        echo "  NPM Proxy: http://npm.$domain"
        echo "    Usage: npm config set registry http://npm.$domain"
    fi

    if [ -n "$COMPOSE_HAND_EDITED" ] && [ ! -f docker-compose.override.yml ]; then
        echo ""
        print_warning "Reminder: your hand edits to docker-compose.yml are NOT active."
        print_warning "Compare $COMPOSE_HAND_EDITED with docker-compose.yml and move them to"
        print_warning "docker-compose.override.yml, then run ./start.sh."
    fi

    local custom
    custom=$(ls data/conf/nginx/custom/*.conf 2>/dev/null || true)
    if [ -n "$custom" ]; then
        echo ""
        print_warning "Custom nginx configs in use (they replace the stock ones):"
        echo "$custom" | sed 's/^/  /'
        # The container writes the .stock copies while starting
        local i
        for i in $(seq 1 30); do
            docker logs "$CONTAINER_NAME" 2>&1 | grep -q "Starting admin server" && break
            sleep 1
        done
        local changed="" conf
        for conf in $custom; do
            [ -f "$conf.stock" ] && changed+="  $conf"$'\n'
        done
        if [ -n "$changed" ]; then
            print_warning "The stock config changed since these were written; they may be missing fixes:"
            printf '%s' "$changed"
            print_warning "Compare each with its .stock copy, merge what you need, then delete the .stock file."
        fi
    fi

    echo ""
    print_status "Logs:"
    echo "  docker logs $CONTAINER_NAME"
    echo "  docker compose -f docker-compose.yml logs"
}

# Things an upgrade from an old release leaves for the admin to do
print_upgrade_notes() {
    local mode=$1
    local cheatsheets=data/data/cheatsheets
    if [ -n "$(find "$cheatsheets" -maxdepth 1 -type f -name '*.md' -print -quit 2>/dev/null)" ]; then
        echo ""
        if ! grep -q '"url"' "$cheatsheets/sources.json" 2>/dev/null; then
            print_warning "Cheatsheets are no longer bundled. To get the tldr pages back, open Cheatsheets in the"
            print_warning "admin panel and add https://github.com/tldr-pages/tldr/tree/main/pages as a source."
        fi
        print_status "The previously bundled cheatsheets in $cheatsheets/*.md are no longer used. Remove them with:"
        echo "  find $cheatsheets -maxdepth 1 -type f -name '*.md' -delete"
    fi

    # Releases before 2.4 run ./setup.sh without --upgrade and then print their own closing lines
    if [ "$mode" = "default" ] && ps -o args= -p "$PPID" 2>/dev/null | grep -qE '(^|[ /])upgrade\.sh( |$)'; then
        local domain
        domain=$(env_get MIRROR_DOMAIN "$ENV_FILE")
        echo ""
        print_warning "The previous release's upgrade.sh prints a closing message next; parts of it are outdated:"
        echo "  - docker-compose.yml is replaced on every upgrade. Keep your changes in"
        echo "    docker-compose.override.yml instead of re-applying them to docker-compose.yml."
        if [ -n "$domain" ] && [ "$domain" != "mirror.intra" ]; then
            echo "  - The addresses are the ones listed above (http://$domain), not mirror.intra."
        fi
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --upgrade               Keep current settings without asking (used by upgrade.sh)"
    echo "  --reconfigure           Ask for every setting, offering the current values"
    echo "  --reset-admin-password  Set a new password for the admin user"
    echo "  --config-only           Only write configuration, don't start the container"
    echo "  --no-cleanup            Skip cleanup of previous installation"
    echo "  --help                  Show this help message"
    echo ""
    echo "On a fresh install this asks for the domain, sync frequency, npm proxy,"
    echo "timezone and admin password. On an existing install it keeps what is"
    echo "configured and never overwrites:"
    echo "  - .env (settings)                       - data/conf/apt-mirror/mirror.list"
    echo "  - data/auth/.htpasswd (users)           - data/conf/nginx/custom/ (nginx overrides)"
    echo "  - docker-compose.override.yml"
    echo ""
    echo "Prerequisites:"
    echo "  - Docker installed and running (with Compose v2 plugin)"
    echo "  - Built images in dist/ directory (run ./build.sh first)"
    echo "  - openssl, curl, tar, gzip, procps (free), awk, sed"
}

# Main execution
main() {
    local config_only=false
    local no_cleanup=false
    local mode="default"
    local reset_password=false

    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --upgrade)
                mode="upgrade"
                shift
                ;;
            --reconfigure)
                mode="reconfigure"
                shift
                ;;
            --reset-admin-password)
                reset_password=true
                shift
                ;;
            --config-only)
                config_only=true
                shift
                ;;
            --no-cleanup)
                no_cleanup=true
                shift
                ;;
            --help)
                show_usage
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done

    print_status "Starting ui-apt-mirror deployment..."

    # Verify required commands are installed
    require_cmd docker openssl free awk sed tar gunzip curl
    require_docker_compose

    # Detect architecture
    local arch=$(detect_architecture)
    print_success "Detected architecture: $arch"

    # Validate dist directory
    validate_dist "$arch"

    load_existing_config
    if [ "$INSTALL_EXISTS" = true ]; then
        print_status "Existing installation detected; your configuration will be kept."
        [ -f "$ENV_FILE" ] || backup_config
    fi

    resolve_user_config "$mode"

    if [ "$INSTALL_EXISTS" = false ] || [ "$reset_password" = true ] || [ ! -s data/auth/.htpasswd ]; then
        prompt_admin_password
        generate_htpasswd "$ADMIN_PASSWORD"
    fi

    create_data_dirs

    # mirror.list is managed in the admin panel after the first install
    if [ "$INSTALL_EXISTS" = false ] || [ ! -f data/conf/apt-mirror/mirror.list ]; then
        calculate_resource_limits
        generate_mirror_config "$MIRROR_DOMAIN"
    else
        print_status "Keeping data/conf/apt-mirror/mirror.list (managed in the admin panel)."
        migrate_mirror_config
    fi

    write_env_file
    install_docker_compose

    if [ "$config_only" = true ]; then
        print_success "Configuration completed. Run ./start.sh to start the container."
        exit 0
    fi

    preserve_private_files

    # Clean up previous installation
    if [ "$no_cleanup" = false ]; then
        cleanup_previous
    fi

    # Start container using start.sh
    print_status "Starting container..."
    ./start.sh

    # Show status
    show_status

    print_success "Deployment completed successfully!"
    print_upgrade_notes "$mode"
}

# Run main function with all arguments
main "$@"
