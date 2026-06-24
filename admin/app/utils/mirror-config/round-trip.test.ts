import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from './parse';
import { serialize } from './serialize';

const here = path.dirname(fileURLToPath(import.meta.url));
const realConfig = path.resolve(
  here,
  '../../../../data/conf/apt-mirror/mirror.list',
);

const SAMPLE = `# apt-mirror2 configuration for mirror.intra

set base_path    /var/spool/apt-mirror
set mirror_path  $base_path/mirror
set _user_agent "apt-mirror2/14"

# ---start---Ubuntu Noble---
# Ubuntu 24.04 (Noble Numbat) repositories
deb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu noble-updates main restricted universe multiverse
# Usage start
#Types: deb
#URIs: http://mirror.intra/archive.ubuntu.com/ubuntu
#Suites: noble noble-updates
#Components: main restricted universe multiverse
# Usage end
# ---end---Ubuntu Noble---

# ---start---Debian Bookworm---
# Debian 12 (Bookworm) repositories
#deb http://deb.debian.org/debian bookworm main contrib non-free
#deb-src http://deb.debian.org/debian bookworm main contrib non-free
# ---end---Debian Bookworm---

# Clean up old packages
clean http://archive.ubuntu.com/ubuntu
clean http://deb.debian.org/debian
`;

describe('round-trip fidelity', () => {
  it('serialize(parse(x)) === x for a representative sample', () => {
    expect(serialize(parse(SAMPLE))).toBe(SAMPLE);
  });

  it('preserves a trailing newline', () => {
    const withNewline = 'set defaultarch amd64\n';
    expect(serialize(parse(withNewline))).toBe(withNewline);
  });

  it('preserves the absence of a trailing newline', () => {
    const noNewline = 'set defaultarch amd64';
    expect(serialize(parse(noNewline))).toBe(noNewline);
  });

  it('preserves blank lines and unknown lines verbatim', () => {
    const messy = '\n\n  weird unparseable line\n\nset x y\n';
    expect(serialize(parse(messy))).toBe(messy);
  });

  it('round-trips the real committed mirror.list byte-for-byte', () => {
    if (!existsSync(realConfig)) {
      // The committed config may be absent in some checkouts; skip rather than
      // fail so the suite stays portable.
      return;
    }
    const content = readFileSync(realConfig, 'utf-8');
    expect(serialize(parse(content))).toBe(content);
  });
});
