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
CONFIG_FILE=".env"

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

# Function to get user configuration
get_user_config() {
    print_status "Getting user configuration..."
    
    # Default values
    local default_domain="mirror.intra"
    local default_sync_freq="14400"
    local default_admin_pass="admin"
    
    # Get custom domain
    echo ""
    read -p "Enter your custom domain (default: $default_domain): " custom_domain
    custom_domain=${custom_domain:-$default_domain}
    
    # Get sync frequency
    echo ""
    echo "Sync frequency options:"
    echo "  1. Every 4 hours"
    echo "  2. Every 12 hours"
    echo "  3. Every 24 hours"
    read -p "Select sync frequency (1-3, default: 1): " sync_choice
    sync_choice=${sync_choice:-1}
    
    # Convert choice to seconds
    case $sync_choice in
        1)
            sync_freq="14400"
            ;;
        2)
            sync_freq="43200"
            ;;
        3)
            sync_freq="86400"
            ;;
        *)
            print_error "Invalid choice. Using default (Every 4 hours)."
            sync_freq="14400"
            ;;
    esac
    
    # Get admin password
    echo ""
    read -s -p "Enter admin password (default: $default_admin_pass): " admin_pass
    echo ""
    admin_pass=${admin_pass:-$default_admin_pass}
    
    # Generate admin password hash
    print_status "Generating admin password hash..."
    local pass_hash=$(openssl passwd -apr1 "$admin_pass")
    
    # Create environment configuration
    cat > "$CONFIG_FILE" << EOF
# ui-apt-mirror Configuration
MIRROR_DOMAIN=$custom_domain
ADMIN_DOMAIN=admin.$custom_domain
FILES_DOMAIN=files.$custom_domain
SYNC_FREQUENCY=$sync_freq
ADMIN_PASSWORD=$admin_pass
ADMIN_PASSWORD_HASH=$pass_hash
EOF
    
    print_success "Configuration saved to $CONFIG_FILE"
}

# Function to generate nginx htpasswd file
generate_htpasswd() {
    local admin_pass=$1
    
    print_status "Generating nginx htpasswd file..."
    
    # Create nginx conf directory if it doesn't exist
    mkdir -p data/conf/nginx
    
    # Generate password hash and create htpasswd file
    local pass_hash=$(openssl passwd -apr1 "$admin_pass")
    echo "admin:$pass_hash" > data/conf/nginx/.htpasswd
    
    print_success "htpasswd file generated successfully."
}

# Function to generate docker-compose.yml from template
generate_docker_compose() {
    local domain=$1
    local sync_freq=$2
    local admin_pass=$3
    
    print_status "Generating docker-compose.yml from template..."
    
    # Remove existing docker-compose.yml if it exists
    if [ -f "docker-compose.yml" ]; then
        print_status "Removing existing docker-compose.yml..."
        rm docker-compose.yml
    fi
    
    # Copy source template
    cp docker-compose.src.yml docker-compose.yml
    
    # Replace environment variable references with actual values
    sed -i "s/\${SYNC_FREQUENCY:-3600}/$sync_freq/g" docker-compose.yml
    sed -i "s/\${MIRROR_DOMAIN:-mirror.intra}/$domain/g" docker-compose.yml
    sed -i "s/\${ADMIN_DOMAIN:-admin.mirror.intra}/admin.$domain/g" docker-compose.yml
    sed -i "s/\${FILES_DOMAIN:-files.mirror.intra}/files.$domain/g" docker-compose.yml
    sed -i "s/\${ADMIN_PASSWORD:-admin}/$admin_pass/g" docker-compose.yml
    
    print_success "docker-compose.yml generated successfully."
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

# Function to load image
load_image() {
    local arch=$1
    local tar_file="${DIST_DIR}/${IMAGE_NAME}-${arch}.tar.gz"
    
    print_status "Loading Docker image..."
    
    # Extract and load the image
    gunzip -c "$tar_file" | docker load
    
    print_success "Image loaded successfully."
}

# Function to create data directories
create_data_dirs() {
    print_status "Creating data directories..."
    
    mkdir -p data/{data/apt-mirror,data/files,logs/apt-mirror,logs/nginx,conf/apt-mirror,conf/nginx/sites-available}
    
    # Set proper permissions
    chmod 755 data/
    chmod 755 data/*
    
    print_success "Data directories created."
}

# Function to generate apt-mirror configuration
generate_mirror_config() {
    local domain=$1
    
    print_status "Generating apt-mirror configuration..."
    
    cat > data/conf/apt-mirror/mirror.list << EOF
# apt-mirror configuration for $domain
# Generated on $(date)

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

# Set nthreads to the number of threads to use
set nthreads     20

# Set _tilde to 1 to download tilde files
set _tilde 0

# Ubuntu 24.04 (Noble Numbat) repositories
deb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu noble-updates main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu noble-security main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu noble-backports main restricted universe multiverse

# Debian 12 (Bookworm) repositories
deb http://deb.debian.org/debian bookworm main contrib non-free non-free-firmware
deb http://deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware
deb http://security.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
deb http://deb.debian.org/debian bookworm-backports main contrib non-free non-free-firmware

# Clean up old packages
clean http://archive.ubuntu.com/ubuntu
clean http://deb.debian.org/debian
clean http://security.debian.org/debian-security
EOF
    
    print_success "apt-mirror configuration generated."
}

# Function to start container
start_container() {
    print_status "Starting container..."
    
    # Start with docker-compose
    docker compose -f docker-compose.yml up -d
    
    print_success "Container started successfully."
}

# Function to show status
show_status() {
    print_status "Container status:"
    docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    
    echo ""
    print_status "Access URLs:"
    if [ -f "docker-compose.yml" ]; then
        # Extract values from generated docker-compose.yml
        local mirror_domain=$(grep "MIRROR_DOMAIN" docker-compose.yml | sed 's/.*MIRROR_DOMAIN: //')
        local admin_domain=$(grep "ADMIN_DOMAIN" docker-compose.yml | sed 's/.*ADMIN_DOMAIN: //')
        local files_domain=$(grep "FILES_DOMAIN" docker-compose.yml | sed 's/.*FILES_DOMAIN: //')
        local admin_pass=$(grep "ADMIN_PASSWORD" docker-compose.yml | sed 's/.*ADMIN_PASSWORD: //')
        
        echo "  Main Repository: http://$mirror_domain"
        echo "  Admin Panel: http://$admin_domain (admin/$admin_pass)"
        echo "  File Repository: http://$files_domain"
    else
        echo "  Main Repository: http://mirror.intra"
        echo "  Admin Panel: http://admin.mirror.intra (admin/admin)"
        echo "  File Repository: http://files.mirror.intra"
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
    echo "  --config-only     Only generate configuration, don't start container"
    echo "  --no-cleanup      Skip cleanup of previous installation"
    echo "  --help            Show this help message"
    echo ""
    echo "This script will:"
    echo "  1. Detect your system architecture"
    echo "  2. Validate that required image files exist"
    echo "  3. Get your custom configuration"
    echo "  4. Clean up previous installation"
    echo "  5. Load the appropriate Docker image"
    echo "  6. Start the container with your configuration"
    echo ""
    echo "Prerequisites:"
    echo "  - Docker installed and running"
    echo "  - Built images in dist/ directory (run ./build.sh first)"
    echo "  - openssl for password hashing"
}

# Main execution
main() {
    local config_only=false
    local no_cleanup=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
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
    
    # Detect architecture
    local arch=$(detect_architecture)
    print_success "Detected architecture: $arch"
    
    # Validate dist directory
    validate_dist "$arch"
    
    # Get user configuration
    get_user_config
    
    # Generate nginx htpasswd file
    if [ -f "$CONFIG_FILE" ]; then
        source "$CONFIG_FILE"
        generate_htpasswd "$ADMIN_PASSWORD"
    else
        generate_htpasswd "admin"
    fi
    
    if [ "$config_only" = true ]; then
        print_success "Configuration completed. Run without --config-only to start the container."
        exit 0
    fi
    
    # Clean up previous installation
    if [ "$no_cleanup" = false ]; then
        cleanup_previous
    fi
    
    # Load image
    load_image "$arch"
    
    # Create data directories
    create_data_dirs
    
    # Generate apt-mirror configuration
    if [ -f "$CONFIG_FILE" ]; then
        source "$CONFIG_FILE"
        generate_mirror_config "$MIRROR_DOMAIN"
    else
        generate_mirror_config "mirror.intra"
    fi
    
    # Generate docker-compose.yml
    if [ -f "$CONFIG_FILE" ]; then
        source "$CONFIG_FILE"
        generate_docker_compose "$MIRROR_DOMAIN" "$SYNC_FREQUENCY" "$ADMIN_PASSWORD"
    else
        generate_docker_compose "mirror.intra" "14400" "admin"
    fi
    
    # Start container
    start_container
    
    # Show status
    show_status
    
    print_success "Deployment completed successfully!"
}

# Run main function with all arguments
main "$@" 