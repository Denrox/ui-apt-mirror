# UI APT Mirror

A containerized APT mirror solution with a web interface. This project provides a complete local Ubuntu / Debian package repository with an admin panel, file hosting capabilities, and optional npm package caching.

## Features

- **APT Mirror**: Local Ubuntu package repository with automatic synchronization using apt-mirror2 (Python/asyncio version) from PyPI
- **NPM Proxy**: Optional local npm package registry cache for faster npm installs and reduced bandwidth usage
- **Web Interface**: web UI for all services
- **Multi-Host Setup**: Four distinct web services:
  - `mirror.intra` - DEB packages repository
  - `admin.mirror.intra` - Admin panel with authentication
  - `files.mirror.intra` - File hosting service
  - `npm.mirror.intra` - NPM registry cache (optional)
- **Advanced File Manager**: File upload/download, directory management, and container image downloads from Docker Hub and GCR
- **Multi-Architecture Support**: Builds for both AMD64 and ARM64
- **Easy Deployment**: Simple scripts for building and deployment
- **Configurable**: Custom domains, sync frequency, admin passwords, and optional npm proxy

## Requirements

- arm64 or amd64 machine
- Docker and Docker Compose
- Linux system
- Complete Mirroring apt repos usually requires a lot of disk space (> 500G) 

## Installation

### 1. Build the Images

First, build the Docker images for your architecture:

```bash
./build.sh
```

This will create:
- `dist/ui-apt-mirror-amd64.tar.gz` (for x86_64 systems)
- `dist/ui-apt-mirror-arm64.tar.gz` (for ARM64 systems)

### 2. Deploy the Container

Run the setup script to deploy the container:

```bash
./setup.sh
```

The script will:
- Detect your system architecture
- Ask for your custom domain (default: `mirror.intra`)
- Configure sync frequency
- Set admin password
- Ask if you need npm proxy functionality (default: Yes)
- Load the appropriate Docker image
- Start the container

## Web Interfaces

### Main Repository (mirror.intra)

- **URL**: `http://mirror.intra`
- **Purpose**: Browse and download mirrored packages
- **Features**:
  - Package browsing with directory listing

### Admin Panel (admin.mirror.intra)

- **URL**: `http://admin.mirror.intra`
- **Authentication**: Auth (username/password)
- **Features**:
  - Mirror status monitoring
  - Log viewing
  - Documentation
  - Files management
  - User management and settings

### File Repository (files.mirror.intra)

- **URL**: `http://files.mirror.intra`
- **Purpose**: File hosting and sharing

### NPM Proxy (npm.mirror.intra) - Optional

- **URL**: `http://npm.mirror.intra`
- **Purpose**: Local npm package registry cache and private package hosting
- **Features**:
  - Caches npm packages locally for faster installs
  - Reduces bandwidth usage
  - Transparent proxy to npmjs.org
  - Private package publishing (requires authentication)
  - Private packages stored separately and never forwarded to npmjs.org

## Usage

### Using the APT Mirror

To use the local repository on your Ubuntu systems, add the following to `/etc/apt/sources.list`:

```bash
# Replace mirror.intra with your custom domain
# For Ubuntu 24.04 (Noble)
Types: deb
URIs: http://mirror.intra/archive.ubuntu.com/ubuntu
Suites: noble noble-updates noble-security noble-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

# For Debian 12 (Bookworm)
deb http://mirror.intra/deb.debian.org/debian bookworm main non-free-firmware
deb http://mirror.intra/security.debian.org/debian-security bookworm-security main non-free-firmware
deb http://mirror.intra/deb.debian.org/debian bookworm-updates main non-free-firmware
```

Then update your package lists:

```bash
sudo apt update
```

### Managing the Mirror

Access the admin panel at `http://admin.mirror.intra` to:
- Monitor sync status
- View logs and statistics

### Using the NPM Proxy

To use the local npm proxy (if enabled during setup), configure npm to use your local registry:

```bash
# Configure npm to use the local proxy
npm config set registry http://npm.mirror.intra

# Or for a specific project
npm install --registry http://npm.mirror.intra

# To revert back to the official registry
npm config set registry https://registry.npmjs.org
```

The npm proxy will:
- Cache packages locally on first download
- Serve cached packages for subsequent requests
- Automatically fetch from npmjs.org if not cached

### Publishing NPM Packages

The npm proxy supports publishing private packages using standard npm commands.

#### Authentication

**Method 1: Using npm login (recommended)**

For npm 9.x+, use the `--auth-type=legacy` flag:

```bash
npm login --registry=http://npm.mirror.intra --auth-type=legacy
# Enter your username and password when prompted
npm whoami --registry=http://npm.mirror.intra
```

**Method 2: Manual token configuration**

If `npm login` doesn't work, you can manually obtain and configure the token:

```bash
TOKEN=$(curl -X PUT http://npm.mirror.intra/-/user/org.couchdb.user:admin \
  -H "Content-Type: application/json" \
  -d '{"name": "admin", "password": "your-password"}' \
  | jq -r .token)
echo "//npm.mirror.intra/:_authToken=$TOKEN" >> ~/.npmrc
npm whoami --registry=http://npm.mirror.intra
```

#### Publishing Packages

Once authenticated, publish packages normally:

```bash
npm publish
```

**Important Notes:**
- All published packages are treated as private packages
- Private packages are stored in `data/data/npm/private/`
- Published packages are **NOT** forwarded to npmjs.org
- Private packages take precedence over cached public packages
- Authentication tokens for npm are JWT-based and valid for 1 year

### File Hosting

Use the file repository at `http://files.mirror.intra` to:
- Upload files via web interface
- Browse uploaded files

## Management

### Upgrading the Installation

To upgrade to the latest version:

```bash
./upgrade.sh
```

The upgrade script will:
- Check connectivity to the official website
- Ask you to choose between current architecture or all architectures
- Download the latest version
- Extract and install new image files
- Run setup.sh to deploy the upgrade
- Clean up temporary files

## Directory Structure

```
ui-apt-mirror/
├── build.sh                 # Build script for Docker images
├── setup.sh                 # Deployment and configuration script
├── start.sh                 # Start the container
├── upgrade.sh               # Upgrade script for latest version
├── README.md                # This file
├── .env                     # Configuration file (generated)
├── docker-compose.src.yml   # Docker Compose template
├── docker-compose.yml       # Generated Docker Compose file
├── Dockerfile               # Multi-stage Docker build
├── entrypoint.sh            # Container startup script
├── admin/                   # Admin panel React application source
│   ├── app/                 # React Router application
│   ├── build/               # Built admin panel assets
│   ├── package.json         # Node.js dependencies
│   └── vite.config.ts       # Vite build configuration
├── scripts/                 # Service scripts
│   ├── health-check.sh      # System health monitoring
│   ├── mirror-sync.sh       # APT mirror synchronization
│   ├── resource-monitor.sh  # Resource usage monitoring
│   ├── start-mirror.sh      # Start mirror services
│   └── stop-mirror.sh       # Stop mirror services
├── dist/                    # Built Docker images
│   ├── ui-apt-mirror-amd64.tar.gz
│   └── ui-apt-mirror-arm64.tar.gz
└── data/                    # Persistent data and configuration
    ├── auth/                # User authentication data
    ├── conf/                # Configuration files
    │   ├── apt-mirror/      # APT mirror configuration
    │   └── nginx/           # Nginx configurations
    ├── data/                # Application data
    │   ├── apt-mirror/      # APT mirror package data
    │   ├── files/           # File hosting data
    │   └── npm/             # NPM cache data
    └── logs/                # Log files
        ├── apt-mirror/      # APT mirror logs
        └── nginx/           # Nginx logs
```

## License

This project is licensed under the MIT License.

## Acknowledgments

- [apt-mirror2](https://gitlab.com/apt-mirror2/apt-mirror2) - The Python/asyncio APT mirroring tool from PyPI
- [nginx](https://nginx.org/) - Web server
- [skopeo](https://github.com/containers/skopeo) - For container image management
