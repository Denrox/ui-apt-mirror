#!/bin/bash

# Build script for ui-apt-mirror
# This script builds Docker images for multiple architectures and saves them to dist/

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="ui-apt-mirror"
VERSION="latest"
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

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    
    # Check if Docker Buildx is available
    if ! docker buildx version &> /dev/null; then
        print_warning "Docker Buildx not available. Installing..."
        docker buildx install
    fi
    
    # Check if Dockerfile exists
    if [ ! -f "Dockerfile" ]; then
        print_error "Dockerfile not found in current directory."
        exit 1
    fi
    
    # Create dist directory if it doesn't exist
    mkdir -p "$DIST_DIR"
    
    print_success "Prerequisites check completed."
}

# Function to create multi-platform builder
setup_builder() {
    print_status "Setting up multi-platform builder..."
    
    # Create a new builder instance if it doesn't exist
    if ! docker buildx inspect multiarch &> /dev/null; then
        docker buildx create --name multiarch --use
    else
        docker buildx use multiarch
    fi
    
    # Bootstrap the builder
    docker buildx inspect --bootstrap
    
    print_success "Multi-platform builder setup completed."
}

# Function to build images for all architectures
build_images() {
    print_status "Building images for all architectures..."
    
    # Define architectures
    ARCHITECTURES=("linux/amd64" "linux/arm64")
    
    # Build for each architecture
    for arch in "${ARCHITECTURES[@]}"; do
        arch_short=$(echo "$arch" | sed 's/linux\///')
        print_status "Building for $arch..."
        
        # Build the image
        docker buildx build \
            --platform "$arch" \
            --tag "${IMAGE_NAME}:${VERSION}" \
            --file "Dockerfile" \
            --load \
            .
        
        # Save the image to tar file
        output_file="${DIST_DIR}/${IMAGE_NAME}-${arch_short}.tar"
        print_status "Saving image to $output_file..."
        
        docker save "${IMAGE_NAME}:${VERSION}" -o "$output_file"
        
        # Compress the tar file
        print_status "Compressing $output_file..."
        gzip -f "$output_file"
        
        print_success "Built and saved ${IMAGE_NAME}-${arch_short}.tar.gz"
    done
}

# Function to build and push to registry (optional)
build_and_push() {
    if [ "$1" = "--push" ]; then
        print_status "Building and pushing to registry..."
        
        # Check if registry is specified
        if [ -z "$REGISTRY" ]; then
            print_error "REGISTRY environment variable not set. Skipping push."
            return
        fi
        
        # Build and push for all architectures
        docker buildx build \
            --platform linux/amd64,linux/arm64 \
            --tag "${REGISTRY}/${IMAGE_NAME}:${VERSION}" \
            --file "Dockerfile" \
            --push \
            .
        
        print_success "Images pushed to registry: ${REGISTRY}/${IMAGE_NAME}:${VERSION}"
    fi
}

# Function to clean up
cleanup() {
    print_status "Cleaning up..."
    
    # Remove the built image
    docker rmi "${IMAGE_NAME}:${VERSION}" 2>/dev/null || true
    
    print_success "Cleanup completed."
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --push              Build and push to registry (requires REGISTRY env var)"
    echo "  --clean             Clean up built images after saving"
    echo "  --help              Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  REGISTRY            Docker registry URL (e.g., docker.io/username)"
    echo "  VERSION             Image version (default: latest)"
    echo ""
    echo "Examples:"
    echo "  $0                  # Build and save images locally"
    echo "  $0 --push           # Build and push to registry"
    echo "  REGISTRY=docker.io/username $0 --push  # Build and push to specific registry"
}

# Main execution
main() {
    local push_flag=false
    local clean_flag=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --push)
                push_flag=true
                shift
                ;;
            --clean)
                clean_flag=true
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
    
    print_status "Starting build process for ui-apt-mirror..."
    
    # Check prerequisites
    check_prerequisites
    
    # Setup builder
    setup_builder
    
    # Build images
    build_images
    
    # Push to registry if requested
    if [ "$push_flag" = true ]; then
        build_and_push --push
    fi
    
    # Cleanup if requested
    if [ "$clean_flag" = true ]; then
        cleanup
    fi
    
    print_success "Build process completed successfully!"
    print_status "Images saved to $DIST_DIR/:"
    ls -la "$DIST_DIR"/*.tar.gz 2>/dev/null || print_warning "No tar files found in $DIST_DIR"
}

# Run main function with all arguments
main "$@" 