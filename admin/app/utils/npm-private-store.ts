import { promises as fs } from 'fs';
import path from 'path';
import { isWithin } from '~/utils/safe-path';
import { isValidName, type PackageDoc } from '~/utils/npm-registry';

/**
 * Private packages live in `<root>/_packages/<name>/`: the packument in `package.json` and the
 * tarballs under `-/`. Every package has a directory of its own, so no name can collide with the
 * files of another.
 */
const PACKAGES_SUBDIR = '_packages';
const DOC_FILE = 'package.json';
const TARBALL_DIR = '-';

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

export class PrivatePackageStore {
  readonly packagesDir: string;
  private layout: Promise<void> | null = null;

  constructor(readonly root: string) {
    this.packagesDir = path.join(root, PACKAGES_SUBDIR);
  }

  packageDir(name: string): string {
    const dir = path.resolve(this.packagesDir, name);
    if (!isValidName(name) || !isWithin(dir, this.packagesDir) || dir === path.resolve(this.packagesDir)) {
      throw new Error('Invalid package path');
    }
    return dir;
  }

  docPath(name: string): string {
    return path.join(this.packageDir(name), DOC_FILE);
  }

  tarballPath(name: string, file: string): string {
    const dir = path.join(this.packageDir(name), TARBALL_DIR);
    const target = path.resolve(dir, file);
    if (!file || !isWithin(target, dir) || target === dir) throw new Error('Invalid package path');
    return target;
  }

  /** Creates the store, once per process. */
  ready(): Promise<void> {
    this.layout ??= fs.mkdir(this.packagesDir, { recursive: true }).then(
      () => {},
      (error) => {
        // Try again on the next request.
        this.layout = null;
        throw error;
      },
    );
    return this.layout;
  }

  async isPrivate(name: string): Promise<boolean> {
    await this.ready();
    const stat = await fs.stat(this.docPath(name)).catch(() => null);
    return !!stat?.isFile();
  }

  async readDoc(name: string): Promise<PackageDoc | null> {
    await this.ready();
    try {
      return JSON.parse(await fs.readFile(this.docPath(name), 'utf-8'));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    }
  }

  async writeDoc(doc: PackageDoc): Promise<void> {
    await this.ready();
    const target = this.docPath(doc.name);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(doc, null, 2));
    await fs.rename(tmp, target);
  }

  async readTarball(name: string, file: string): Promise<Buffer> {
    await this.ready();
    return fs.readFile(this.tarballPath(name, file));
  }

  async writeTarball(name: string, file: string, data: Buffer): Promise<void> {
    await this.ready();
    const target = this.tarballPath(name, file);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, target);
  }

  async removeTarball(name: string, file: string): Promise<void> {
    await this.ready();
    await fs.rm(this.tarballPath(name, file));
  }

  /** Removes the package with all its tarballs, and its scope directory once that is empty. */
  async removePackage(name: string): Promise<void> {
    await this.ready();
    await fs.rm(this.packageDir(name), { recursive: true, force: true });
    if (name.startsWith('@')) {
      await fs.rmdir(path.dirname(this.packageDir(name))).catch(() => {});
    }
  }
}
