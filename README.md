# UI APT Mirror

A containerized APT mirror solution with a web interface. This project provides a complete local Ubuntu / Debian package repository with an admin panel, file hosting capabilities, optional npm package caching, and developer cheatsheets. Perfect for organizations that need to work in a totally offline environment while maintaining access to essential development resources.

## Features

- **APT Mirror**: Local Ubuntu package repository with automatic synchronization using apt-mirror2 (Python/asyncio version) from PyPI
- **GPG Signing**: Optional per-host signing keys generated via the admin panel — re-signs `Release` files so clients can verify the mirror with a real key instead of relying on `[trusted=yes]`. Sources.list snippets in the admin UI auto-include the correct `signed-by` / `Signed-By` directive when a key is present.
- **NPM Proxy**: Optional local npm package registry cache for faster npm installs and reduced bandwidth usage
- **Cheatsheets**: Offline, searchable markdown cheatsheets downloaded from GitHub repositories you choose (e.g. [tldr-pages](https://github.com/tldr-pages/tldr) for console commands)
- **Web Interface**: web UI for all services
- **Multi-Host Setup**: Five distinct web services:
  - `mirror.intra` - DEB packages repository
  - `admin.mirror.intra` - Admin panel with authentication
  - `files.mirror.intra` - File hosting service
  - `npm.mirror.intra` - NPM registry cache (optional)
  - `cheatsheets.mirror.intra` - Public developer cheatsheets (no authentication)
- **Advanced File Manager**: File upload/download, directory management, built-in media player for video/audio files, and container image downloads from Docker Hub and GCR
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
- Save these settings to `.env`
- Load the appropriate Docker image
- Start the container

Running `./setup.sh` again on an existing install keeps your configuration. Use
`./setup.sh --reconfigure` to change settings (current values are the defaults)
and `./setup.sh --reset-admin-password` to set a new admin password; other users
are kept.

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
  - Cheatsheet sources (add GitHub repositories, update, remove)
  - User management and settings

Failed logins (web and `npm login`) are limited per client address and per
username. The container has no IPv6 address, so Docker's userland proxy
connects IPv6 clients and clients on the Docker host itself (`127.0.0.1`,
`::1`) from the network gateway, and they all reach the mirror with that one
address. The limit for the gateway is per username, so one of those clients
can't lock the others out, but they can't be told apart either. The same goes
for a reverse proxy in front of the mirror: its clients share its address, and
the mirror ignores `X-Forwarded-For` because any client can send one.

### File Repository (files.mirror.intra)

- **URL**: `http://files.mirror.intra`
- **Purpose**: File hosting and sharing
- **Features**:
  - Built-in video/audio player supporting MP4, WebM, AVI, MKV, MP3, WAV, FLAC, and more
  - Stream large files (optimized for 8GB+ videos) with HTTP range requests
  - Horizontal media gallery for quick browsing of files in the same folder
  - Autoplay when selecting media files

### Public Cheatsheets (cheatsheets.mirror.intra)

- **URL**: `http://cheatsheets.mirror.intra`
- **Authentication**: None (public access)
- **Purpose**: Read-only access to the downloaded cheatsheets
- **Features**:
  - Full-text search across all sources, with snippets
  - Browse by source and category
  - Works fully offline once sources are downloaded

#### Adding cheatsheet sources

No cheatsheets are bundled. In the admin panel, open **Cheatsheets** and paste a
public GitHub URL:

- a repository: `https://github.com/<owner>/<repo>` (default branch)
- or one folder of it: `https://github.com/<owner>/<repo>/tree/<branch>/<folder>`,
  e.g. `https://github.com/tldr-pages/tldr/tree/main/pages` for tldr's console commands

Every `.md` file under that location becomes a page (README/LICENSE/CONTRIBUTING
files are skipped). The first `# Heading` is the page title. Sub-folders become
categories, unless the folder contains a `categories.json` mapping
`{"Category": ["relative/path.md", ...]}`. Downloading needs internet access;
**Update** re-downloads a source and keeps the previous copy if it fails.
Content is stored under `data/data/cheatsheets/` and is not part of this repository.

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
deb http://mirror.intra/deb.debian.org/debian bookworm main contrib non-free non-free-firmware
deb http://mirror.intra/security.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware
deb http://mirror.intra/deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware
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
- Public packages (cached from npmjs.org) are stored in `data/data/npm/public/`
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
- Back up your configuration, users, repository signing keys and cheatsheet
  sources list to `backups/pre-upgrade-<date>.tar.gz`
- Download the latest version and install the new image and scripts
- Run `setup.sh --upgrade`, which asks nothing and keeps your configuration
- Clean up temporary files

#### What an upgrade keeps

| What | Where | On upgrade |
|------|-------|------------|
| Settings (domain, sync frequency, timezone, npm proxy) | `.env` | kept |
| Your own compose changes (ports, volumes, …) | `docker-compose.override.yml` | kept |
| Repositories and package filters | `data/conf/apt-mirror/mirror.list` | kept |
| Users and passwords | `data/auth/.htpasswd` | kept |
| Login signing secret | `data/auth/.jwt-secret` | kept |
| Nginx overrides | `data/conf/nginx/custom/<site>.conf` | kept |
| Mirrored packages, GPG keys, files, private files, npm cache, cheatsheets | `data/data/` | kept |
| `docker-compose.yml` | stock file | replaced (holds no settings) |
| Nginx site configs | generated in the container from `.env` | regenerated |

Do not edit `docker-compose.yml`: put changes in `docker-compose.override.yml`
instead (same format, merged on top by `start.sh`). To change an nginx site,
copy it from the running container (`docker exec ui-apt-mirror cat
/etc/nginx/sites-available/files.mirror.intra.conf`) to
`data/conf/nginx/custom/files.mirror.intra.conf` and edit it there; delete the
file to go back to the stock config. An override that is an unedited stock
config of an earlier release (2.4.x upgrades created those) is moved to
`data/conf/nginx/custom.unedited-<date>/` and the current stock config is used.

#### Upgrading from older versions

The first upgrade of an install that predates `.env` migrates it automatically:
settings are read from the old `docker-compose.yml`, nginx configs you had
edited become overrides in `data/conf/nginx/custom/` (unedited ones, from any
release, are replaced by the current stock configs), and private files are
copied out of the old container (they were not stored on the host before). If
the old `docker-compose.yml` had hand edits, it is saved under `backups/` and
the upgrade tells you to move those edits to `docker-compose.override.yml`.

Every install signs logins with its own secret now, so everyone has to sign in
again once, and npm tokens from `npm login` must be renewed.

Installs whose `upgrade.sh` does not copy a new `setup.sh` (versions from before
August 2025) should fetch the current `upgrade.sh` before upgrading:

```bash
curl -fsSLO https://raw.githubusercontent.com/Denrox/ui-apt-mirror/master/upgrade.sh
chmod +x upgrade.sh && ./upgrade.sh
```

## Directory Structure

```
ui-apt-mirror/
├── build.sh                 # Build script for Docker images
├── setup.sh                 # Deployment and configuration script
├── start.sh                 # Start the container
├── upgrade.sh               # Upgrade script for latest version
├── README.md                # This file
├── .env                     # Settings (written by setup.sh, kept on upgrade)
├── docker-compose.src.yml   # Docker Compose template
├── docker-compose.yml       # Stock copy of the template (replaced on upgrade)
├── docker-compose.override.yml  # Optional: your compose changes (kept on upgrade)
├── backups/                 # Configuration backups made by upgrade.sh
├── nginx/                   # Nginx site templates baked into the image
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
    ├── auth/                # Users (.htpasswd) and login secret (.jwt-secret)
    ├── conf/                # Configuration files
    │   ├── apt-mirror/      # APT mirror configuration (mirror.list)
    │   └── nginx/custom/    # Optional nginx site overrides
    ├── data/                # Application data
    │   ├── apt-mirror/      # APT mirror package data
    │   ├── files/           # File hosting data
    │   ├── files-private/   # Private files
    │   ├── cheatsheets/     # Downloaded cheatsheet sources
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
