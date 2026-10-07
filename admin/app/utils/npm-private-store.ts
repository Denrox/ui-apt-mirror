import { promises as fs } from 'fs';
import path from 'path';
import { isWithin } from '~/utils/safe-path';
import { isValidName, type PackageDoc } from '~/utils/npm-registry';

/**
 * Private packages live in `<root>/_packages/<name>/`: the packument in `package.json` and the
 * tarballs under `-/`. Every package has a directory of its own, so no name can collide with the
 * files of another (`left-pad.json` used to land on `left-pad`'s document). Package names never
 * start with `_`, so the tree cannot clash with the old layout it replaces.
 */
export const PACKAGES_SUBDIR = '_packages';
const DOC_FILE = 'package.json';
const TARBALL_DIR = '-';

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

async function exists(p: string): Promise<boolean> {
  return fs.lstat(p).then(
    () => true,
    () => false,
  );
}

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

  /** Creates the store and moves packages of the old layout into it, once per process. */
  ready(): Promise<void> {
    this.layout ??= this.migrateLegacyLayout().catch((error) => {
      // Try again on the next request; until then nothing is served that could miss a private name.
      this.layout = null;
      throw error;
    });
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
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
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

  /**
   * The old layout kept `<root>/<name>.json` next to `<root>/<name>/-/<tarball>`. Each document
   * found there is moved with its tarballs; tarballs go first, so an interrupted run resumes cleanly.
   */
  private async migrateLegacyLayout(): Promise<void> {
    await fs.mkdir(this.packagesDir, { recursive: true });

    const legacy: { name: string; dir: string; base: string }[] = [];
    const collect = async (dir: string, scope?: string) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (!scope && entry.isDirectory() && entry.name.startsWith('@')) {
          await collect(path.join(dir, entry.name), entry.name);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          const base = entry.name.slice(0, -'.json'.length);
          const name = scope ? `${scope}/${base}` : base;
          if (isValidName(name)) legacy.push({ name, dir, base });
        }
      }
    };
    await collect(this.root);

    const failed: string[] = [];
    for (const { name, dir, base } of legacy) {
      try {
        const target = this.packageDir(name);
        if (await exists(path.join(target, DOC_FILE))) {
          console.warn(`npm: ${name} exists in both package layouts; keeping ${path.join(dir, `${base}.json`)} as is`);
          continue;
        }
        await fs.mkdir(target, { recursive: true });
        const oldTarballs = path.join(dir, base, TARBALL_DIR);
        const newTarballs = path.join(target, TARBALL_DIR);
        if ((await exists(oldTarballs)) && !(await exists(newTarballs))) {
          await fs.rename(oldTarballs, newTarballs);
        }
        await fs.rename(path.join(dir, `${base}.json`), path.join(target, DOC_FILE));
        await fs.rmdir(path.join(dir, base)).catch(() => {});
        console.log(`npm: moved private package ${name} to ${target}`);
      } catch (error) {
        console.error(`npm: could not move private package ${name}:`, error);
        failed.push(name);
      }
    }
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('@')) {
        await fs.rmdir(path.join(this.root, entry.name)).catch(() => {});
      }
    }
    if (failed.length) throw new Error(`Could not move private packages: ${failed.join(', ')}`);
  }
}
