#!/bin/bash

# Upgrade script for ui-apt-mirror
# Downloads and installs the latest version from https://ui-apt-mirror.dbashkatov.com/

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WEBSITE_URL="https://ui-apt-mirror.dbashkatov.com"
TEMP_DIR="./tmp"
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

# Function to check connectivity to the website
check_connectivity() {
    print_status "Checking connectivity to $WEBSITE_URL..."
    
    if curl -s --head --fail "$WEBSITE_URL" > /dev/null 2>&1; then
        print_success "Connectivity check passed"
        return 0
    else
        print_error "Cannot connect to $WEBSITE_URL"
        print_error "Please check your internet connection and try again"
        exit 1
    fi
}

# Function to get user choice for architecture
get_architecture_choice() {
    local current_arch=$(detect_architecture)
    
    echo ""
    echo "Current system architecture: $current_arch"
    echo ""
    echo "Choose download option:"
    echo "  1. Download current architecture only ($current_arch)"
    echo "  2. Download all architectures (amd64 + arm64)"
    echo ""
    
    while true; do
        read -p "Enter your choice (1 or 2): " choice
        case $choice in
            1)
                ARCH_CHOICE="current"
                DOWNLOAD_ARCH=$current_arch
                DOWNLOAD_URL="$WEBSITE_URL/downloads/ui-apt-mirror-$current_arch.tar"
                print_success "Selected: Current architecture ($current_arch)"
                break
                ;;
            2)
                ARCH_CHOICE="all"
                DOWNLOAD_ARCH="all"
                DOWNLOAD_URL="$WEBSITE_URL/downloads/ui-apt-mirror-all.tar"
                print_success "Selected: All architectures"
                break
                ;;
            *)
                print_error "Invalid choice. Please enter 1 or 2."
                ;;
        esac
    done
}

# Function to download the latest version
download_latest() {
    print_status "Downloading latest version..."
    print_status "URL: $DOWNLOAD_URL"
    
    # Create temp directory
    mkdir -p "$TEMP_DIR"
    
    # Download the file
    if curl -L -o "$TEMP_DIR/ui-apt-mirror.tar" "$DOWNLOAD_URL"; then
        print_success "Download completed successfully"
    else
        print_error "Download failed"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
}

# Function to extract and install
extract_and_install() {
    print_status "Extracting downloaded archive..."
    
    # Extract to temp directory
    if tar -xzf "$TEMP_DIR/ui-apt-mirror.tar" -C "$TEMP_DIR"; then
        print_success "Archive extracted successfully"
    else
        print_error "Failed to extract archive"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
    
    # Check if dist directory exists in extracted content
    if [ ! -d "$TEMP_DIR/dist" ]; then
        print_error "Invalid archive format: dist directory not found"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
    
    # Create dist directory if it doesn't exist
    mkdir -p "$DIST_DIR"
    
    # Move image files to dist directory
    print_status "Installing new image files..."
    for image_file in "$TEMP_DIR"/dist/*.tar.gz; do
        if [ -f "$image_file" ]; then
            local filename=$(basename "$image_file")
            print_status "Installing $filename..."
            cp "$image_file" "$DIST_DIR/"
            print_success "Installed $filename"
        fi
    done
    
    # Check if any files were installed
    if [ -z "$(ls -A "$DIST_DIR"/*.tar.gz 2>/dev/null)" ]; then
        print_error "No image files found in the downloaded archive"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
    
    print_success "Image files installed successfully"
}

# Function to run setup
run_setup() {
    print_status "Running setup script..."
    
    if [ -f "./setup.sh" ]; then
        print_status "Starting setup process..."
        ./setup.sh
    else
        print_error "setup.sh not found in current directory"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
}

# Function to cleanup
cleanup() {
    print_status "Cleaning up temporary files..."
    rm -rf "$TEMP_DIR"
    print_success "Cleanup completed"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help            Show this help message"
    echo ""
    echo "This script will:"
    echo "  1. Check connectivity to $WEBSITE_URL"
    echo "  2. Ask user to choose architecture (current or all)"
    echo "  3. Download the latest version"
    echo "  4. Extract and install new image files"
    echo "  5. Run setup.sh to deploy the upgrade"
    echo "  6. Clean up temporary files"
    echo ""
    echo "Prerequisites:"
    echo "  - Internet connection"
    echo "  - curl for downloading"
    echo "  - tar for extraction"
    echo "  - setup.sh in current directory"
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
    
    print_status "Starting ui-apt-mirror upgrade process..."
    
    # Check connectivity
    check_connectivity
    
    # Get user choice for architecture
    get_architecture_choice
    
    # Download latest version
    download_latest
    
    # Extract and install
    extract_and_install
    
    # Run setup
    run_setup
    
    # Cleanup
    cleanup
    
    print_success "Upgrade completed successfully!"
    echo ""
    print_status "The new version is now running. You can access it at:"
    echo "  - Main Repository: http://mirror.intra"
    echo "  - Admin Panel: http://admin.mirror.intra"
    echo "  - File Repository: http://files.mirror.intra"
}

# Run main function with all arguments
main "$@" 