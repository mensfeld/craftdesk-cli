import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { logger } from '../utils/logger';
import { configManager } from './config-manager';
import { CraftDeskLock, LockEntry } from '../types/craftdesk-lock';
import { ensureDir } from '../utils/file-system';
import { verifyFileChecksum, formatChecksum } from '../utils/crypto';

/**
 * Handles installation of crafts from various sources
 *
 * Supports installing from:
 * - Registry packages (via download URLs)
 * - Git repositories (with monorepo support)
 * - Local archives
 *
 * Organizes installations by craft type in the .claude directory.
 *
 * @example
 * ```typescript
 * const installer = new Installer();
 *
 * // Install from lockfile
 * const lockfile = await readLockfile();
 * await installer.installFromLockfile(lockfile);
 *
 * // Install single craft
 * await installer.installCraft('ruby-on-rails', lockEntry);
 * ```
 */
export class Installer {
  private installPath: string;

  constructor() {
    this.installPath = configManager.getInstallPath();
  }

  /**
   * Installs all crafts defined in a lockfile
   *
   * Processes each craft sequentially, updating progress as it goes.
   * Fails fast if any installation errors occur.
   *
   * @param lockfile - The craftdesk.lock content with all dependencies
   * @throws Error if any craft fails to install
   *
   * @example
   * ```typescript
   * const lockfile = {
   *   version: '1.0.0',
   *   lockfileVersion: 1,
   *   crafts: {
   *     'ruby-on-rails': { version: '7.1.0', ... },
   *     'postgres-expert': { version: '1.2.0', ... }
   *   }
   * };
   *
   * await installer.installFromLockfile(lockfile);
   * ```
   */
  async installFromLockfile(lockfile: CraftDeskLock): Promise<void> {
    const installDir = path.join(process.cwd(), this.installPath);
    await ensureDir(installDir);

    const crafts = Object.entries(lockfile.crafts);
    let installed = 0;

    for (const [name, entry] of crafts) {
      try {
        logger.updateSpinner(`Installing ${name}@${entry.version} (${installed + 1}/${crafts.length})`);
        await this.installCraft(name, entry);
        installed++;
      } catch (error: any) {
        logger.failSpinner(`Failed to install ${name}: ${error.message}`);
        throw error;
      }
    }

    logger.succeedSpinner(`Installed ${installed} crafts`);
  }

  /**
   * Installs a single craft from registry or git source
   *
   * Installation process:
   * 1. Determines installation directory based on craft type
   * 2. For git dependencies: clones and extracts subdirectory
   * 3. For registry: downloads archive, verifies, and extracts
   * 4. Creates metadata file for tracking installation
   *
   * @param name - The name of the craft to install
   * @param entry - Lockfile entry containing installation details
   * @throws Error if download or extraction fails
   *
   * @example
   * ```typescript
   * // Install from registry
   * await installer.installCraft('ruby-on-rails', {
   *   version: '7.1.0',
   *   resolved: 'https://craftdesk.ai/download/...',
   *   type: 'skill',
   *   dependencies: {}
   * });
   *
   * // Install from git
   * await installer.installCraft('custom-auth', {
   *   version: '1.0.0',
   *   git: 'https://github.com/company/auth.git',
   *   branch: 'main',
   *   type: 'agent',
   *   dependencies: {}
   * });
   * ```
   */
  async installCraft(name: string, entry: LockEntry): Promise<void> {
    const installDir = path.join(process.cwd(), this.installPath);

    // Determine install subdirectory based on type
    const typeDir = this.getTypeDirectory(entry.type);
    const craftDir = path.join(installDir, typeDir, name);

    // Create directory
    await ensureDir(craftDir);

    // Check if this is a git dependency
    if (entry.git) {
      await this.installFromGit(craftDir, entry);
    } else {
      // Download craft archive (ZIP format from CraftDesk registry)
      const archivePath = path.join(craftDir, 'archive.zip');
      await this.downloadFile(entry.resolved, archivePath);

      // Verify integrity using SHA-256 checksum
      if (entry.integrity) {
        logger.debug(`Verifying checksum for ${name}...`);
        const isValid = await verifyFileChecksum(archivePath, entry.integrity);

        if (!isValid) {
          await fs.remove(archivePath);
          throw new Error(
            `Checksum verification failed for ${name}@${entry.version}. ` +
            `Expected: ${formatChecksum(entry.integrity)}... ` +
            `This may indicate a corrupted download or a security issue. ` +
            `Try running 'craftdesk install --no-lockfile' to re-resolve dependencies.`
          );
        }

        logger.debug(`Checksum verified: ${formatChecksum(entry.integrity)}...`);
      } else {
        logger.warn(`No checksum available for ${name}@${entry.version} - skipping verification`);
      }

      // Extract archive
      await this.extractArchive(archivePath, craftDir);

      // Clean up archive
      await fs.remove(archivePath);
    }

    // Create metadata file
    await this.createMetadata(craftDir, name, entry);
  }

  private async installFromGit(craftDir: string, entry: LockEntry): Promise<void> {
    const tempDir = path.join(craftDir, '.tmp-git');

    try {
      // Clone the repository
      const { execSync } = require('child_process');

      // Build clone command with appropriate ref
      let cloneCmd = `git clone --depth 1`;

      if (entry.branch) {
        cloneCmd += ` -b ${entry.branch}`;
      } else if (entry.tag) {
        cloneCmd += ` -b ${entry.tag}`;
      }

      cloneCmd += ` ${entry.git} ${tempDir}`;

      logger.debug(`Cloning git repository: ${cloneCmd}`);
      execSync(cloneCmd, { stdio: 'pipe' });

      // If specific commit, checkout that commit
      if (entry.commit) {
        execSync(`cd ${tempDir} && git fetch --unshallow && git checkout ${entry.commit}`, { stdio: 'pipe' });
      }

      // Handle direct file reference
      if (entry.file) {
        const sourceFile = path.join(tempDir, entry.file);
        const destFile = path.join(craftDir, path.basename(entry.file));

        if (await fs.pathExists(sourceFile)) {
          await fs.copy(sourceFile, destFile, { overwrite: true });
        } else {
          throw new Error(`File not found: ${entry.file} in ${entry.git}`);
        }
      } else {
        // Copy from subdirectory if specified, otherwise copy entire repo
        const sourcePath = entry.path ? path.join(tempDir, entry.path) : tempDir;

        // Copy contents to craft directory
        const files = await fs.readdir(sourcePath);
        for (const file of files) {
          if (file !== '.tmp-git' && file !== '.git') {
            await fs.copy(
              path.join(sourcePath, file),
              path.join(craftDir, file),
              { overwrite: true }
            );
          }
        }
      }

    } finally {
      // Clean up temp directory
      await fs.remove(tempDir);
    }
  }

  private getTypeDirectory(type: string): string {
    switch (type) {
      case 'skill':
        return 'skills';
      case 'agent':
        return 'agents';
      case 'command':
        return 'commands';
      case 'hook':
        return 'hooks';
      default:
        return 'crafts';
    }
  }

  private async downloadFile(url: string, outputPath: string): Promise<void> {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  private async extractArchive(archivePath: string, outputDir: string): Promise<void> {
    try {
      // CraftDesk web API returns ZIP archives
      const zip = new AdmZip(archivePath);
      zip.extractAllTo(outputDir, /* overwrite */ true);
      logger.debug(`Extracted ZIP archive to ${outputDir}`);
    } catch (error: any) {
      throw new Error(`Failed to extract archive: ${error.message}`);
    }
  }

  private async createMetadata(craftDir: string, name: string, entry: LockEntry): Promise<void> {
    const metadata = {
      name,
      version: entry.version,
      type: entry.type,
      author: entry.author,
      installedAt: new Date().toISOString(),
      registry: entry.registry,
      dependencies: entry.dependencies
    };

    await fs.writeFile(
      path.join(craftDir, '.craftdesk-metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf-8'
    );
  }

  async removeCraft(name: string, type: string): Promise<void> {
    const installDir = path.join(process.cwd(), this.installPath);
    const typeDir = this.getTypeDirectory(type);
    const craftDir = path.join(installDir, typeDir, name);

    if (await fs.pathExists(craftDir)) {
      await fs.remove(craftDir);
      logger.success(`Removed ${name}`);
    } else {
      logger.warn(`${name} is not installed`);
    }
  }

  async listInstalled(): Promise<Array<{ name: string; version: string; type: string }>> {
    const installDir = path.join(process.cwd(), this.installPath);
    const installed: Array<{ name: string; version: string; type: string }> = [];

    if (!await fs.pathExists(installDir)) {
      return installed;
    }

    const typeDirs = ['skills', 'agents', 'commands', 'hooks', 'plugins'];

    for (const typeDir of typeDirs) {
      const dir = path.join(installDir, typeDir);
      if (!await fs.pathExists(dir)) continue;

      const crafts = await fs.readdir(dir);
      for (const craftName of crafts) {
        const metadataPath = path.join(dir, craftName, '.craftdesk-metadata.json');
        if (await fs.pathExists(metadataPath)) {
          const metadata = await fs.readJson(metadataPath);
          installed.push({
            name: craftName,
            version: metadata.version,
            type: metadata.type
          });
        }
      }
    }

    return installed;
  }
}

export const installer = new Installer();