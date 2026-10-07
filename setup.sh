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
# Written by setup.sh since 3.0; an install without it is a 2.x one (see refuse_2x_install)
VERSION_FILE=".ui-apt-mirror-version"

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

# Stops before anything is changed if this directory holds a 2.x install: 3.0 can't
# upgrade those. Every 2.x setup.sh wrote .env or docker-compose.yml; .htpasswd covers
# an install whose settings files were deleted.
refuse_2x_install() {
    local mode=$1
    [ -f "$VERSION_FILE" ] && return 0
    [ -f "$ENV_FILE" ] || [ -f docker-compose.yml ] || [ -s data/auth/.htpasswd ] || return 0

    print_error "This directory holds a ui-apt-mirror 2.x install. Version 3 can't upgrade it;"
    print_error "your settings and data were not changed, and its container keeps running."
    if [ "$mode" = "upgrade" ]; then
        echo "The 2.x upgrade.sh already replaced the scripts, README.md and the image in dist/ with"
        echo "version 3's. Delete ./tmp (the downloaded release)."
    fi
    cat <<'MSG'

To move to version 3, install it fresh (also in README.md, "Moving from 2.x"):
  1. Back up your settings, users, signing keys and files:
       tar -czf ../ui-apt-mirror-2.x-backup.tar.gz .env docker-compose*.yml data/conf data/auth \
           data/data/apt-mirror/gpg data/data/files data/data/files-private
  2. Install version 3 in a new directory. It stops and replaces the 2.x container,
     which has the same name and ports:
       curl -fsSLO https://ui-apt-mirror.dbashkatov.com/downloads/install.sh && bash install.sh
  3. Copy over what you want to keep with cp -a, then run docker restart ui-apt-mirror:
       data/data/files, data/data/files-private    public and private files
       data/data/apt-mirror                         mirrored packages and signing keys
       data/conf/apt-mirror/mirror.list             repositories
     Set up users, npm packages and cheatsheet sources again in the admin panel.
MSG
    exit 1
}

# Settings live in .env (read by docker compose). setup.sh changes only its own keys
# there (write_env_file); the admin's other lines are kept.

# Read KEY from a KEY=VALUE file without sourcing it
env_get() {
    grep -E "^$1=" "$2" 2>/dev/null | tail -n 1 | cut -d= -f2-
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
    # Fresh installs offer the proxy enabled
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

# Same rules as the admin panel: 4+ characters, at most 256 bytes (openssl
# ignores the rest), no control characters (openssl hashes only the first line).
admin_password_error() {
    local pass=$1 bytes
    bytes=$(printf '%s' "$pass" | LC_ALL=C wc -c)
    if [ "${#pass}" -lt 4 ]; then
        echo "The password must be at least 4 characters long."
    elif [ "$bytes" -gt 256 ]; then
        echo "The password must be at most 256 bytes long."
    elif [[ "$pass" == *[[:cntrl:]]* ]]; then
        echo "The password must not contain tabs or other control characters."
    fi
}

# Sets ADMIN_PASSWORD. There is no default: an empty answer asks again.
# Without a terminal, ADMIN_PASSWORD must already be set in the environment.
prompt_admin_password() {
    local pass confirm error
    if [ -n "${ADMIN_PASSWORD:-}" ]; then
        error=$(admin_password_error "$ADMIN_PASSWORD")
        if [ -n "$error" ]; then
            print_error "ADMIN_PASSWORD: $error"
            exit 1
        fi
        print_status "Using the admin password from ADMIN_PASSWORD."
        return
    fi
    if [ ! -t 0 ]; then
        print_error "No terminal to ask for the admin password: set ADMIN_PASSWORD, or run setup.sh interactively."
        exit 1
    fi
    while true; do
        echo ""
        # -r and an empty IFS keep backslashes and leading/trailing spaces as typed
        if ! IFS= read -r -s -p "Enter admin password (at least 4 characters): " pass; then
            echo ""
            print_error "No admin password entered."
            exit 1
        fi
        echo ""
        error=$(admin_password_error "$pass")
        if [ -n "$error" ]; then
            print_warning "$error"
            continue
        fi
        IFS= read -r -s -p "Repeat admin password: " confirm || confirm=
        echo ""
        if [ "$pass" != "$confirm" ]; then
            print_warning "The passwords do not match. Try again."
            continue
        fi
        ADMIN_PASSWORD=$pass
        return
    done
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

# The settings setup.sh owns in .env, in the order a fresh install writes them
ENV_KEYS="MIRROR_DOMAIN SYNC_FREQUENCY NPM_PROXY_ENABLED TZ"

# A fresh install writes .env with a header. On an existing .env only the lines of
# ENV_KEYS are changed in place and missing ones appended: every other line (the
# admin's variables and comments) is kept, and so are the file's owner and mode.
write_env_file() {
    local npm_enabled="false" tmp
    [ "$ENABLE_NPM_PROXY" = "y" ] && npm_enabled="true"

    if [ ! -e "$ENV_FILE" ]; then
        print_status "Saving settings to $ENV_FILE..."
        cat > "$ENV_FILE" <<ENVEOF
# ui-apt-mirror settings. Change with ./setup.sh --reconfigure, or edit and run ./start.sh.
# The admin, files, npm and cheatsheets hosts are subdomains of MIRROR_DOMAIN.
MIRROR_DOMAIN=$MIRROR_DOMAIN
SYNC_FREQUENCY=$SYNC_FREQUENCY
NPM_PROXY_ENABLED=$npm_enabled
TZ=$HOST_TIMEZONE
ENVEOF
        print_success "Settings saved."
        return
    fi

    tmp=$(mktemp "$ENV_FILE.XXXXXX")
    if ! SET_MIRROR_DOMAIN=$MIRROR_DOMAIN SET_SYNC_FREQUENCY=$SYNC_FREQUENCY \
        SET_NPM_PROXY_ENABLED=$npm_enabled SET_TZ=$HOST_TIMEZONE \
        awk -v keys="$ENV_KEYS" '
            BEGIN { n = split(keys, key, " ") }
            {
                for (i = 1; i <= n; i++) {
                    if (index($0, key[i] "=") == 1) {
                        print key[i] "=" ENVIRON["SET_" key[i]]
                        seen[i] = 1
                        next
                    }
                }
                print
            }
            END { for (i = 1; i <= n; i++) if (!seen[i]) print key[i] "=" ENVIRON["SET_" key[i]] }
        ' "$ENV_FILE" > "$tmp"; then
        rm -f "$tmp"
        print_error "Could not update $ENV_FILE"
        exit 1
    fi
    if cmp -s "$tmp" "$ENV_FILE"; then
        rm -f "$tmp"
        print_status "Settings in $ENV_FILE are up to date."
        return
    fi
    print_status "Updating settings in $ENV_FILE (other lines are kept)..."
    # Rewrite the file itself, not a new one, so its owner and mode stay
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
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

install_docker_compose() {
    # Differs from the file we installed last time: hand edits
    if [ -f docker-compose.yml ]; then
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

    # The container drops unedited overrides and writes the .stock copies while
    # starting; list the overrides once it is done
    local i
    for i in $(seq 1 60); do
        docker logs --since "${CONTAINER_STARTED_AT:-0}" "$CONTAINER_NAME" 2>&1 \
            | grep -q "Starting admin server" && break
        [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null)" = true ] || break
        sleep 1
    done
    local custom
    custom=$(ls data/conf/nginx/custom/*.conf 2>/dev/null || true)
    if [ -n "$custom" ]; then
        echo ""
        print_warning "Custom nginx configs in use (they replace the stock ones):"
        echo "$custom" | sed 's/^/  /'
        local changed="" conf
        for conf in $custom; do
            [ -f "$conf.stock" ] && changed+="  $conf"$'\n'
        done
        if [ -n "$changed" ]; then
            print_warning "These may be missing fixes made to the stock config (it changed since they were"
            print_warning "written, or it is not known which version they were written against):"
            printf '%s' "$changed"
            print_warning "Compare each with its .stock copy, merge what you need, then delete the .stock file."
        fi
    fi

    echo ""
    print_status "Logs:"
    echo "  docker logs $CONTAINER_NAME"
    echo "  docker compose -f docker-compose.yml logs"
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
    echo "The admin password is asked for (twice) when it is set. To run without a"
    echo "terminal, pass it as ADMIN_PASSWORD=... in the environment."
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

    refuse_2x_install "$mode"
    echo 3 > "$VERSION_FILE"

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
    fi

    write_env_file
    install_docker_compose

    if [ "$config_only" = true ]; then
        print_success "Configuration completed. Run ./start.sh to start the container."
        exit 0
    fi

    # Clean up previous installation
    if [ "$no_cleanup" = false ]; then
        cleanup_previous
    fi

    # Start container using start.sh
    print_status "Starting container..."
    CONTAINER_STARTED_AT=$(date +%s)
    ./start.sh

    # Show status
    show_status

    print_success "Deployment completed successfully!"
}

# "source setup.sh --lib" only defines the functions (tests/setup-env.sh)
if [ "${1:-}" = --lib ]; then
    return 0 2>/dev/null || exit 0
fi

# Run main function with all arguments
main "$@"
