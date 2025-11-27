import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';
import { configManager } from './config-manager';
import { settingsManager } from './settings-manager';
import { CraftDeskLock, LockEntry } from '../types/craftdesk-lock';
import { ensureDir } from '../utils/file-system';
import { verifyFileChecksum, formatChecksum } from '../utils/crypto';
import type { PluginManifest } from '../types/claude-settings';

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

    // Register plugin in settings if this is a plugin type
    if (entry.type === 'plugin') {
      await this.registerPlugin(name, entry, craftDir);
    }
  }

  private async installFromGit(craftDir: string, entry: LockEntry): Promise<void> {
    const tempDir = path.join(craftDir, '.tmp-git');

    try {
      // Clone the repository

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
        // Check if repo is shallow before trying to unshallow
        const isShallow = await fs.pathExists(path.join(tempDir, '.git', 'shallow'));
        if (isShallow) {
          execSync(`cd ${tempDir} && git fetch --unshallow`, { stdio: 'pipe' });
        }
        execSync(`cd ${tempDir} && git checkout ${entry.commit}`, { stdio: 'pipe' });
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

  /**
   * Get the type-specific directory for a craft type
   */
  getTypeDirectory(type: string): string {
    switch (type) {
      case 'skill':
        return 'skills';
      case 'agent':
        return 'agents';
      case 'command':
        return 'commands';
      case 'hook':
        return 'hooks';
      case 'plugin':
        return 'plugins';
      default:
        return 'crafts';
    }
  }

  /**
   * Get the install path (e.g., '.claude')
   */
  getInstallPath(): string {
    return this.installPath;
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

  /**
   * Register a plugin in .claude/settings.json
   */
  private async registerPlugin(name: string, entry: LockEntry, craftDir: string): Promise<void> {
    try {
      // Try to read plugin.json manifest
      const manifest = await this.readPluginManifest(craftDir);

      // Scan directory for actual components
      const scannedComponents = await this.scanPluginComponents(craftDir);

      // Merge manifest components (declared) with scanned components (actual)
      // Manifest takes precedence if both exist (manifest is source of truth)
      const components: {
        skills?: string[];
        agents?: string[];
        commands?: string[];
        hooks?: string[];
      } = {};

      // Start with scanned components
      if (scannedComponents.skills) components.skills = scannedComponents.skills;
      if (scannedComponents.agents) components.agents = scannedComponents.agents;
      if (scannedComponents.commands) components.commands = scannedComponents.commands;
      if (scannedComponents.hooks) components.hooks = scannedComponents.hooks;

      // Override with manifest if provided (manifest is source of truth)
      if (manifest?.components) {
        if (manifest.components.skills) components.skills = manifest.components.skills;
        if (manifest.components.agents) components.agents = manifest.components.agents;
        if (manifest.components.commands) components.commands = manifest.components.commands;
        if (manifest.components.hooks) components.hooks = manifest.components.hooks;
      }

      // Build plugin config for settings
      const pluginConfig = {
        name,
        version: entry.version,
        type: 'plugin' as const,
        enabled: true,
        installPath: path.relative(this.installPath, craftDir),
        installedAt: new Date().toISOString(),
        dependencies: entry.dependencies ? Object.keys(entry.dependencies) : [],
        isDependency: entry.installedAs === 'dependency',
        // Copy metadata from plugin.json manifest
        ...(manifest?.description && { description: manifest.description }),
        ...(manifest?.author && { author: manifest.author }),
        ...(manifest?.license && { license: manifest.license }),
        ...(manifest?.homepage && { homepage: manifest.homepage }),
        ...(manifest?.repository && { repository: manifest.repository }),
        ...(manifest?.keywords && { keywords: manifest.keywords }),
        // Use merged components (scanned + manifest)
        ...(Object.keys(components).length > 0 && { components }),
        // CraftDesk-specific fields
        ...(manifest?.scripts && { scripts: manifest.scripts })
      };

      await settingsManager.registerPlugin(pluginConfig);
      logger.debug(`Registered plugin ${name} in settings.json`);

      // Register MCP servers if provided in manifest (official Claude Code field)
      if (manifest?.mcpServers) {
        if (typeof manifest.mcpServers === 'object' && !Array.isArray(manifest.mcpServers)) {
          // Inline MCP server configuration
          for (const [serverName, serverConfig] of Object.entries(manifest.mcpServers)) {
            await settingsManager.registerMCPServer(serverName, serverConfig);
            logger.debug(`Registered MCP server: ${serverName}`);
          }
        } else if (typeof manifest.mcpServers === 'string') {
          // Path to .mcp.json file - would need to read and parse it
          const mcpPath = path.join(craftDir, manifest.mcpServers);
          if (await fs.pathExists(mcpPath)) {
            try {
              const mcpConfig = await fs.readJson(mcpPath);
              for (const [serverName, serverConfig] of Object.entries(mcpConfig)) {
                await settingsManager.registerMCPServer(serverName, serverConfig as any);
                logger.debug(`Registered MCP server from ${manifest.mcpServers}: ${serverName}`);
              }
            } catch (error: any) {
              logger.warn(`Failed to read MCP config from ${manifest.mcpServers}: ${error.message}`);
            }
          }
        }
      }
    } catch (error: any) {
      logger.warn(`Failed to register plugin ${name}: ${error.message}`);
      // Non-fatal - plugin is still installed, just not registered in settings
    }
  }

  /**
   * Read plugin.json manifest from plugin directory
   * Plugin manifest is located at .claude-plugin/plugin.json
   */
  private async readPluginManifest(pluginDir: string): Promise<PluginManifest | null> {
    const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');

    try {
      if (await fs.pathExists(manifestPath)) {
        const content = await fs.readFile(manifestPath, 'utf-8');
        return JSON.parse(content) as PluginManifest;
      }
      return null;
    } catch (error: any) {
      logger.debug(`Failed to read plugin manifest: ${error.message}`);
      return null;
    }
  }

  /**
   * Scan plugin directory to discover components
   * This ensures we find all skills/agents/commands/hooks even if not listed in plugin.json
   */
  private async scanPluginComponents(pluginDir: string): Promise<{
    skills?: string[];
    agents?: string[];
    commands?: string[];
    hooks?: string[];
  }> {
    const components: {
      skills?: string[];
      agents?: string[];
      commands?: string[];
      hooks?: string[];
    } = {};

    const componentTypes = ['skills', 'agents', 'commands', 'hooks'] as const;

    for (const type of componentTypes) {
      const typeDir = path.join(pluginDir, type);

      if (await fs.pathExists(typeDir)) {
        try {
          const entries = await fs.readdir(typeDir, { withFileTypes: true });
          let items: string[];

          // Commands and hooks are files (*.md), not directories
          if (type === 'commands' || type === 'hooks') {
            items = entries
              .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
              .map(entry => entry.name);
          } else {
            // Skills and agents are directories
            items = entries
              .filter(entry => entry.isDirectory())
              .map(entry => entry.name);
          }

          if (items.length > 0) {
            components[type] = items;
          }
        } catch (error: any) {
          logger.debug(`Failed to scan ${type} directory: ${error.message}`);
        }
      }
    }

    return components;
  }

  async removeCraft(name: string, type: string): Promise<void> {
    const installDir = path.join(process.cwd(), this.installPath);
    const typeDir = this.getTypeDirectory(type);
    const craftDir = path.join(installDir, typeDir, name);

    if (await fs.pathExists(craftDir)) {
      // Unregister plugin from settings if this is a plugin
      if (type === 'plugin') {
        try {
          await settingsManager.unregisterPlugin(name);
          logger.debug(`Unregistered plugin ${name} from settings`);
        } catch (error: any) {
          logger.warn(`Failed to unregister plugin: ${error.message}`);
        }
      }

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