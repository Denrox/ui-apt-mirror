import fs from 'fs/promises';
import path from 'path';

export default async function updateCategories(cheatsheetsDir: string) {
  try {
    const files = await fs.readdir(cheatsheetsDir);
    const mdFiles = files.filter(file => file.endsWith('.md') && file !== 'README.md');

    const categories = {
      'Git & Version Control': [],
      'Docker & Containers': [],
      'System Administration': [],
      'File Operations': [],
      'Network & Web': [],
      'Package Management': [],
      'Text Processing': [],
      'Compression & Archives': [],
      'Development Tools': [],
      'Database & Storage': [],
      'Security & Authentication': [],
      'Process Management': [],
      'System Monitoring': [],
      'Linux Specific': [],
      'Miscellaneous': []
    };

    for (const file of mdFiles) {
      const cmd = file.replace('.md', '');
      
      if (cmd.startsWith('git') || 'git-' in cmd) {
        categories['Git & Version Control'].push(file);
      }
      else if (cmd.startsWith('docker')) {
        categories['Docker & Containers'].push(file);
      }
      else if (['sudo', 'su', 'useradd', 'usermod', 'groupadd', 'passwd', 'chmod', 'chown', 'systemctl', 'service', 'systemd', 'cron', 'at', 'mount', 'umount', 'fdisk', 'parted', 'mkfs', 'fsck', 'dd', 'sync', 'shutdown', 'reboot', 'halt', 'poweroff', 'init', 'runlevel', 'telinit'].includes(cmd)) {
        categories['System Administration'].push(file);
      }
      else if (['ls', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'find', 'locate', 'which', 'whereis', 'file', 'stat', 'touch', 'ln', 'readlink', 'realpath', 'basename', 'dirname', 'pathchk', 'rename', 'chattr', 'lsattr'].includes(cmd)) {
        categories['File Operations'].push(file);
      }
      else if (['curl', 'wget', 'ssh', 'scp', 'rsync', 'ping', 'ping6', 'traceroute', 'netstat', 'ss', 'nmap', 'telnet', 'nc', 'ftp', 'sftp', 'smbclient', 'wireshark', 'tcpdump', 'iptables', 'ufw', 'firewall-cmd', 'host', 'nslookup', 'dig'].includes(cmd)) {
        categories['Network & Web'].push(file);
      }
      else if (['apt', 'apt-get', 'apt-cache', 'dpkg', 'yum', 'dnf', 'rpm', 'pacman', 'zypper', 'snap', 'flatpak', 'nix', 'nix-env', 'nix-store', 'nix-build', 'nix-shell', 'brew', 'port', 'urpmi', 'emerge', 'pkg', 'pkg_add', 'pkg_info', 'pkg_delete'].includes(cmd)) {
        categories['Package Management'].push(file);
      }
      else if (['grep', 'awk', 'sed', 'cut', 'sort', 'uniq', 'wc', 'head', 'tail', 'less', 'more', 'cat', 'tac', 'nl', 'pr', 'fold', 'tr', 'expand', 'unexpand', 'fmt', 'column', 'paste', 'join', 'comm', 'diff', 'cmp', 'patch'].includes(cmd)) {
        categories['Text Processing'].push(file);
      }
      else if (['tar', 'gzip', 'gunzip', 'bzip2', 'bunzip2', 'xz', 'unxz', 'zip', 'unzip', 'rar', 'unrar', '7z', '7za', '7zr', 'lz4', 'zstd'].includes(cmd)) {
        categories['Compression & Archives'].push(file);
      }
      else if (['make', 'cmake', 'gcc', 'g++', 'clang', 'python', 'python3', 'node', 'npm', 'yarn', 'pip', 'pip3', 'gem', 'cargo', 'go', 'javac', 'java', 'mvn', 'gradle', 'ant', 'sbt', 'stack', 'cabal', 'ghc', 'ghci', 'rustc', 'cargo', 'mix', 'elixir', 'erlang', 'rebar3', 'hex'].includes(cmd)) {
        categories['Development Tools'].push(file);
      }
      else if (['mysql', 'mysqldump', 'psql', 'sqlite3', 'mongo', 'mongod', 'redis-cli', 'redis-server', 'sqlcmd', 'sqlite', 'sqlplus'].includes(cmd)) {
        categories['Database & Storage'].push(file);
      }
      else if (['openssl', 'gpg', 'ssh-keygen', 'ssh-add', 'ssh-agent', 'passwd', 'chage', 'su', 'sudo', 'visudo', 'last', 'who', 'w', 'id', 'groups', 'newgrp', 'umask', 'ulimit'].includes(cmd)) {
        categories['Security & Authentication'].push(file);
      }
      else if (['ps', 'top', 'htop', 'kill', 'killall', 'pkill', 'pgrep', 'jobs', 'fg', 'bg', 'nohup', 'screen', 'tmux', 'at', 'batch', 'cron', 'crontab', 'systemctl', 'service'].includes(cmd)) {
        categories['Process Management'].push(file);
      }
      else if (['df', 'du', 'free', 'vmstat', 'iostat', 'sar', 'uptime', 'load', 'lsof', 'fuser', 'strace', 'ltrace', 'perf', 'valgrind', 'gdb', 'lldb', 'dmesg', 'journalctl', 'logrotate'].includes(cmd)) {
        categories['System Monitoring'].push(file);
      }
      else if (['lspci', 'lsusb', 'lsmod', 'modprobe', 'insmod', 'rmmod', 'depmod', 'lsblk', 'blkid', 'e2fsck', 'resize2fs', 'tune2fs', 'debugfs', 'dumpe2fs', 'e2label', 'mke2fs', 'fsck.ext2', 'fsck.ext3', 'fsck.ext4', 'mkfs.ext2', 'mkfs.ext3', 'mkfs.ext4', 'xfs_admin', 'xfs_check', 'xfs_db', 'xfs_fsr', 'xfs_growfs', 'xfs_info', 'xfs_io', 'xfs_logprint', 'xfs_mdrestore', 'xfs_metadump', 'xfs_mkfile', 'xfs_quota', 'xfs_repair', 'xfs_rtcp', 'xfs_spaceman', 'xfs_scrub', 'xfs_scrub_all', 'xfs_scrub_corrupt', 'xfs_scrub_repair', 'xfs_scrub_report', 'xfs_scrub_status', 'xfs_scrub_verify'].includes(cmd)) {
        categories['Linux Specific'].push(file);
      }
      else {
        categories['Miscellaneous'].push(file);
      }
    }

    const categoriesPath = path.join(cheatsheetsDir, 'categories.json');
    await fs.writeFile(categoriesPath, JSON.stringify(categories, null, 2));

    console.log(`Updated categories.json with ${mdFiles.length} files across ${Object.keys(categories).length} categories`);
    
  } catch (error) {
    console.error('Error updating categories:', error);
    throw error;
  }
}
