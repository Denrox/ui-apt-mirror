# UI APT Mirror

A comprehensive APT mirror solution with a modern web interface, built with Docker. This project provides a complete local Ubuntu package repository with an intuitive admin panel and file hosting capabilities.

## 🚀 Features

- **APT Mirror**: Local Ubuntu package repository with automatic synchronization
- **Web Interface**: web UI for all services
- **Multi-Host Setup**: Three distinct web services:
  - `mirror.intra` - DEB packages repository
  - `admin.mirror.intra` - Admin panel with authentication
  - `files.mirror.intra` - File hosting service
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
│  │   nginx     │  │ apt-mirror  │  │ health-check│        │
│  │   (web)     │  │   (sync)    │  │  (monitor)  │        │
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

## 🎛️ Configuration

### Configuration Process

The setup script uses a template-based approach:

1. **Template File**: `docker-compose.src.yml` contains the base configuration with environment variable placeholders
2. **Generation**: The setup script copies the template to `docker-compose.yml` and replaces placeholders with actual values
3. **Customization**: You can modify the generated `docker-compose.yml` file directly if needed

### Configuration Variables

The following variables are configured during startup:

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRROR_DOMAIN` | `mirror.intra` | Main repository domain |
| `ADMIN_DOMAIN` | `admin.mirror.intra` | Admin panel domain |
| `FILES_DOMAIN` | `files.mirror.intra` | File hosting domain |
| `SYNC_FREQUENCY` | `14400` | Sync frequency in seconds (Every 4 hours) |

**Sync Frequency Options:**
- Every 4 hours (14400 seconds) - Default
- Every 12 hours (43200 seconds)
- Every 24 hours (86400 seconds)

### Data Directories

The following directories are automatically created and mounted:

| Directory | Container Path | Purpose |
|-----------|----------------|---------|
| `./data/data/apt-mirror` | `/var/spool/apt-mirror` | APT mirror data |
| `./data/data/files` | `/var/www/files` | File hosting data |
| `./data/logs/apt-mirror` | `/var/log` | Application logs |
| `./data/logs/nginx` | `/var/log/nginx` | Nginx logs |
| `./data/conf/apt-mirror` | `/etc/apt` | APT mirror configuration |
| `./data/conf/nginx/sites-available/` | `/etc/nginx/sites-available/` | Nginx configurations |
| `./data/conf/nginx/.htpasswd` | `/etc/nginx/.htpasswd` | Nginx authentication file |

### APT Mirror Configuration

The apt-mirror configuration is automatically generated and includes:
- Ubuntu 24.04 (Noble Numbat) repositories
- Debian 12 (Bookworm) repositories
- Main, restricted, universe, and multiverse components
- Security and updates repositories
- Automatic cleanup of old packages

### Nginx Configuration

Nginx configurations are mounted as volumes from `./data/conf/nginx/` and include:
- `nginx.conf` - Main nginx configuration
- `mirror.intra.conf` - Main repository virtual host
- `admin.mirror.intra.conf` - Admin panel virtual host with authentication
- `files.mirror.intra.conf` - File hosting virtual host

You can modify these configurations without rebuilding the container. Changes take effect after restarting the container.

## 🌐 Web Interfaces

### Main Repository (mirror.intra)

- **URL**: `http://mirror.intra`
- **Purpose**: Browse and download Ubuntu packages
- **Features**:
  - Package browsing with directory listing
  - Download statistics
  - Usage instructions
  - Quick links to other services

### Admin Panel (admin.mirror.intra)

- **URL**: `http://admin.mirror.intra`
- **Authentication**: Basic auth (admin/password)
- **Features**:
  - Mirror status monitoring
  - Sync controls (start/stop)
  - Statistics and metrics
  - Log viewing
  - Configuration management

### File Repository (files.mirror.intra)

- **URL**: `http://files.mirror.intra`
- **Purpose**: File hosting and sharing
- **Features**:
  - Drag-and-drop file upload
  - File browsing with icons
  - Download statistics
  - Disk usage monitoring

## 📊 Usage

### Using the APT Mirror

To use the local repository on your Ubuntu systems, add the following to `/etc/apt/sources.list`:

```bash
# Replace mirror.intra with your custom domain
# For Ubuntu 24.04 (Noble)
deb http://mirror.intra/ubuntu/ noble main restricted universe multiverse
deb http://mirror.intra/ubuntu/ noble-updates main restricted universe multiverse
deb http://mirror.intra/ubuntu/ noble-security main restricted universe multiverse

# For Debian 12 (Bookworm)
deb http://mirror.intra/debian/ bookworm main contrib non-free non-free-firmware
deb http://mirror.intra/debian/ bookworm-updates main contrib non-free non-free-firmware
deb http://mirror.intra/debian-security bookworm-security main contrib non-free non-free-firmware
```

Then update your package lists:

```bash
sudo apt update
```

### Managing the Mirror

Access the admin panel at `http://admin.mirror.intra` to:
- Monitor sync status
- Start/stop synchronization
- View logs and statistics
- Manage configuration

### File Hosting

Use the file repository at `http://files.mirror.intra` to:
- Upload files via web interface
- Browse uploaded files
- Download files
- Monitor disk usage

## 🔧 Management

### Viewing Logs

```bash
# Container logs
docker logs ui-apt-mirror

# Docker Compose logs
docker compose -f docker-compose.yml logs

# Specific service logs
docker compose -f docker-compose.yml logs ui-apt-mirror
```

### Stopping the Container

```bash
docker compose -f docker-compose.yml down
```

### Restarting the Container

```bash
docker compose -f docker-compose.yml restart
```

### Updating Configuration

To update the configuration:

1. **Automatic Method**: Run `./setup.sh` again to regenerate configuration
2. **Manual Method**: 
   - Stop the container: `docker compose -f docker-compose.yml down`
   - Edit the generated `docker-compose.yml` file directly
   - Restart the container: `docker compose -f docker-compose.yml up -d`

**Note**: The `.env` file is used internally by the setup script. For manual changes, edit `docker-compose.yml` directly.

## 📁 Directory Structure

```
ui-apt-mirror/
├── build.sh                 # Build script for Docker images
├── setup.sh               # Deployment and configuration script
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

- [apt-mirror](https://github.com/apt-mirror/apt-mirror) - The APT mirroring tool
- [nginx](https://nginx.org/) - Web server
- [Docker](https://docker.com/) - Containerization platform
