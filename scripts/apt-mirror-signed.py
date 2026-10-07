#!/usr/bin/env python3
"""Run apt-mirror2 and re-sign each repository's Release files as it is published.

apt-mirror2 publishes a repository's fresh upstream InRelease / Release.gpg as soon as that
repository is done, while the rest of the run can take hours or fail. A client that trusts only
our key (the dashboard's Signed-By snippet) would reject the mirror until the run ended.

This wrapper signs the new metadata before it goes live: with use_dists_move (the default)
apt-mirror2 builds `dists.apt_mirror_new` and swaps it in with shutil.move, so the folder is
signed just before that move, and the swap is made atomic. After the move the published tree
is checked again (this covers use_dists_move 0); sign-releases.sh --dir only touches Release files our key has not signed.

If the apt-mirror2 internals this relies on are missing (another version), it runs apt-mirror2
unchanged and mirror-sync.sh's signing after the run is the fallback.
"""

import ctypes
import os
import shutil
import subprocess
import sys
from pathlib import Path

SIGN_SCRIPT = "/usr/local/bin/sign-releases.sh"


def log(message: str) -> None:
    print(f"apt-mirror-signed: {message}", flush=True)


def sign_dir(path: Path) -> None:
    """Sign the Release files under one dists folder; never let a failure stop the sync."""
    if not os.access(SIGN_SCRIPT, os.X_OK):
        return
    try:
        subprocess.run([SIGN_SCRIPT, "--dir", str(path)], check=False, timeout=600)
    except Exception as error:  # noqa: BLE001 - signing must not break mirroring
        log(f"signing {path} failed: {error}")


def exchange(a: Path, b: Path) -> bool:
    """Swap two paths atomically (Linux renameat2 RENAME_EXCHANGE); False if unsupported."""
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        at_fdcwd, rename_exchange = -100, 2
        return libc.renameat2(at_fdcwd, os.fsencode(a), at_fdcwd, os.fsencode(b), rename_exchange) == 0
    except (AttributeError, OSError):
        return False


def install_hooks(module) -> bool:
    mirror_cls = getattr(module, "RepositoryMirror", None)
    original_move = getattr(mirror_cls, "move_metadata", None)
    new_suffix = getattr(mirror_cls, "MOVE_FOLDER_NEW_SUFFIX", None)
    if original_move is None or new_suffix is None or getattr(module, "shutil", None) is not shutil:
        return False

    old_suffix = getattr(mirror_cls, "MOVE_FOLDER_OLD_SUFFIX", None)
    swapped: set[str] = set()

    class SigningShutil:
        """shutil for apt_mirror.apt_mirror: publishes a signed dists folder in one step.

        apt-mirror2 moves `dists` to `dists.apt_mirror_old`, then `dists.apt_mirror_new` to
        `dists`, so for a moment there is no `dists` at all. Here the new folder is signed first
        and exchanged with the live one atomically (renameat2 RENAME_EXCHANGE); the old content
        then goes where apt-mirror2 expects it, and the second move becomes a no-op.
        """

        def __getattr__(self, name):
            return getattr(shutil, name)

        def move(self, src, dst, *args, **kwargs):
            src, dst = Path(src), Path(dst)
            new = src.with_name(f"{src.name}{new_suffix}")
            if old_suffix and dst.name.endswith(old_suffix) and new.is_dir() and src.is_dir():
                sign_dir(new)
                if exchange(new, src):
                    os.rename(new, dst)
                    swapped.add(str(src))
                    return dst
                return shutil.move(src, dst, *args, **kwargs)
            if src.name.endswith(new_suffix):
                if str(dst) in swapped:
                    swapped.discard(str(dst))
                    return dst
                if src.is_dir():
                    sign_dir(src)
            return shutil.move(src, dst, *args, **kwargs)

    async def move_metadata(self, *args, **kwargs):
        result = await original_move(self, *args, **kwargs)
        try:
            config = self._config
            published = config.mirror_path / self._repository.get_mirror_path(config.encode_tilde)
            if (published / "dists").is_dir():
                sign_dir(published / "dists")
        except Exception as error:  # noqa: BLE001
            log(f"post-move signing skipped: {error}")
        return result

    module.shutil = SigningShutil()
    mirror_cls.move_metadata = move_metadata
    return True


def main() -> int:
    from apt_mirror import apt_mirror as module

    if not install_hooks(module):
        log("this apt-mirror2 version has no hook point; Release files are signed after the run")
    return module.main()


if __name__ == "__main__":
    sys.exit(main())
