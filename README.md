# UI APT Mirror

A containerized APT mirror solution with a web interface. This project provides a complete local Ubuntu / Debian package repository with an admin panel and file hosting capabilities.

## 🚀 Features

- **APT Mirror**: Local Ubuntu package repository with automatic synchronization using apt-mirror2 (Python/asyncio version) from PyPI
- **Web Interface**: web UI for all services
- **Multi-Host Setup**: Three distinct web services:
  - `mirror.intra` - DEB packages repository
  - `admin.mirror.intra` - Admin panel with authentication
  - `files.mirror.intra` - File hosting service
- **Advanced File Manager**: File upload/download, directory management, and container image downloads from Docker Hub and GCR
- **Multi-Architecture Support**: Builds for both AMD64 and ARM64
- **Easy Deployment**: Simple scripts for building and deployment
- **Configurable**: Custom domains, sync frequency, and admin passwords

## 📋 Requirements

- arm64 or amd64 machine
- Docker and Docker Compose
- Linux system
- Complete Mirroring apt repos usually requires a lot of disk space (> 500G) 

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    UI APT Mirror Container                  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   nginx     │  │ apt-mirror2 │  │ health-check│        │
│  │   (web)     │  │   (sync)    │  │  (monitor)  │        │
│  │             │  │  (Python)   │  │             │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
├─────────────────────────────────────────────────────────────┤
│  mirror.intra  │  admin.mirror.intra  │  files.mirror.intra │
│  (packages)    │     (admin panel)    │   (file hosting)    │
└─────────────────────────────────────────────────────────────┘
```

## 🛠️ Installation

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
- Load the appropriate Docker image
- Start the container

## 🌐 Web Interfaces

### Main Repository (mirror.intra)

- **URL**: `http://mirror.intra`
- **Purpose**: Browse and download mirrored packages
- **Features**:
  - Package browsing with directory listing

### Admin Panel (admin.mirror.intra)

- **URL**: `http://admin.mirror.intra`
- **Authentication**: Basic auth (admin/password)
- **Features**:
  - Mirror status monitoring
  - Log viewing
  - Documentation
  - Files management

### File Repository (files.mirror.intra)

- **URL**: `http://files.mirror.intra`
- **Purpose**: File hosting and sharing

## 📊 Usage

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

### File Hosting

Use the file repository at `http://files.mirror.intra` to:
- Upload files via web interface
- Browse uploaded files

## 🔧 Management

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

## 📁 Directory Structure

```
ui-apt-mirror/
├── build.sh                 # Build script for Docker images
├── setup.sh               # Deployment and configuration script
├── upgrade.sh             # Upgrade script for latest version
├── README.md               # This file
├── .env                    # Configuration file (generated)
├── docker-compose.src.yml  # Docker Compose template
├── docker-compose.yml      # Generated Docker Compose file
├── dist/                   # Built Docker images
│   ├── ui-apt-mirror-amd64.tar.gz
│   └── ui-apt-mirror-arm64.tar.gz
├── Dockerfile              # Multi-stage Docker build
├── entrypoint.sh           # Container startup script
├── scripts/                # Service scripts
└── web/                    # Web content
    ├── mirror.intra/
    ├── admin.mirror.intra/
    └── files.mirror.intra/
└── data/                   # Persistent data and configuration
    ├── data/apt-mirror/    # APT mirror data
    ├── data/files/         # File hosting data
    ├── logs/apt-mirror/    # Application logs
    ├── logs/nginx/         # Nginx logs
    ├── conf/apt-mirror/    # APT mirror configuration
    └── conf/nginx/         # Nginx configurations
```

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- [apt-mirror2](https://gitlab.com/apt-mirror2/apt-mirror2) - The Python/asyncio APT mirroring tool from PyPI
- [nginx](https://nginx.org/) - Web server
- [skopeo](https://github.com/containers/skopeo) - For container image management
