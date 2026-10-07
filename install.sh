#!/bin/bash
# Quick start: download the latest ui-apt-mirror release and run setup.sh.
#
#   curl -fsSLO https://ui-apt-mirror.dbashkatov.com/downloads/install.sh && bash install.sh
#
# Installs into ./ui-apt-mirror (or $UI_APT_MIRROR_DIR). An existing installation is
# never touched: use its ./upgrade.sh instead.

set -e

WEBSITE_URL="https://ui-apt-mirror.dbashkatov.com"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

detect_arch() {
    case $(uname -m) in
        x86_64) echo "amd64" ;;
        aarch64|arm64) echo "arm64" ;;
        *)
            print_error "Unsupported architecture: $(uname -m)"
            exit 1
            ;;
    esac
}

validate_dependencies() {
    print_info "Validating system dependencies..."
    local missing_deps=()
    command -v curl &> /dev/null || missing_deps+=("curl")
    command -v tar &> /dev/null || missing_deps+=("tar")
    if ! command -v docker &> /dev/null; then
        missing_deps+=("docker")
    elif ! docker compose version &> /dev/null; then
        missing_deps+=("docker compose plugin")
    fi
    if [ ${#missing_deps[@]} -gt 0 ]; then
        print_error "Missing required dependencies:"
        for dep in "${missing_deps[@]}"; do
            echo "  - $dep"
        done
        echo ""
        print_info "Please install the missing dependencies and try again."
        exit 1
    fi
    print_info "All required dependencies are installed ✓"
}

check_target() {
    local target=$1
    [ -e "$target" ] || return 0
    if [ -f "$target/.env" ] || [ -f "$target/docker-compose.yml" ] || [ -d "$target/data" ]; then
        print_error "ui-apt-mirror is already installed in $target."
        print_error "To update it, run: cd $target && ./upgrade.sh"
        exit 1
    fi
    if [ -n "$(ls -A "$target")" ]; then
        print_error "$target exists and is not empty; choose another directory with UI_APT_MIRROR_DIR."
        exit 1
    fi
}

main() {
    print_info "Starting ui-apt-mirror installation..."
    validate_dependencies

    local arch target
    arch=$(detect_arch)
    target=${UI_APT_MIRROR_DIR:-$PWD/ui-apt-mirror}
    print_info "Detected architecture: $arch"
    check_target "$target"

    # The release archive holds the scripts and the image of the same build. It is global so that the EXIT trap,
    # which runs after main has returned, still sees its path.
    archive=$(mktemp)
    trap 'rm -f "$archive"' EXIT
    print_info "Downloading the latest release for $arch..."
    curl -fL -o "$archive" "$WEBSITE_URL/downloads/ui-apt-mirror-${arch}.tar"

    mkdir -p "$target"
    print_info "Extracting into $target..."
    tar --no-same-owner -xf "$archive" -C "$target"
    rm -f "$archive"
    if [ ! -f "$target/setup.sh" ] || ! ls "$target"/dist/*.tar.gz &> /dev/null; then
        print_error "The downloaded release is incomplete (setup.sh or image missing)."
        exit 1
    fi

    cd "$target"
    print_info "Running setup.sh in $(pwd)..."
    chmod +x ./*.sh
    ./setup.sh
    print_info "Installation completed successfully!"
}

if [ "$EUID" -ne 0 ]; then
    print_warning "This script may need to be run as root for the setup process"
    print_warning "If setup fails, try running with: sudo $0"
fi

main
