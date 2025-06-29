#!/bin/bash

# Start script for ui-apt-mirror
# This script handles loading the Docker image and starting the container

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

# Function to load image
load_image() {
    local arch=$1
    local tar_file="${DIST_DIR}/${IMAGE_NAME}-${arch}.tar.gz"
    
    print_status "Loading Docker image..."
    
    # Extract and load the image
    gunzip -c "$tar_file" | docker load
    
    print_success "Image loaded successfully."
}

# Function to start container
start_container() {
    print_status "Starting container..."
    
    # Start with docker-compose
    docker compose -f docker-compose.yml up -d
    
    print_success "Container started successfully."
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help            Show this help message"
    echo ""
    echo "This script will:"
    echo "  1. Detect your system architecture"
    echo "  2. Validate that required image files exist"
    echo "  3. Load the appropriate Docker image"
    echo "  4. Start the container"
    echo ""
    echo "Prerequisites:"
    echo "  - Docker installed and running"
    echo "  - Built images in dist/ directory (run ./build.sh first)"
    echo "  - docker-compose.yml file exists (run ./setup.sh first)"
}

# Main execution
main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
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
    
    print_status "Starting ui-apt-mirror..."
    
    # Detect architecture
    local arch=$(detect_architecture)
    print_success "Detected architecture: $arch"
    
    # Validate dist directory
    validate_dist "$arch"
    
    # Load image
    load_image "$arch"
    
    # Start container
    start_container
    
    print_success "Container started successfully!"
}

# Run main function with all arguments
main "$@" 