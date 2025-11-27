import { Command } from 'commander';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import {
  readCraftDeskJson,
  readCraftDeskLock,
  writeCraftDeskJson,
  writeCraftDeskLock
} from '../utils/file-system';
import { logger } from '../utils/logger';
import { registryClient } from '../services/registry-client';
import { installer } from '../services/installer';
import { configManager } from '../services/config-manager';
import { LockEntry, CraftDeskLock } from '../types/craftdesk-lock';
import {
  isNewerVersion,
  sortTagsBySemver,
  getUpdateType,
  padRight,
  colorize
} from '../utils/version-utils';

interface UpdateInfo {
  name: string;
  current: string;
  latest: string;
  type: string;
  source: 'registry' | 'git';
  lockEntry: LockEntry;
  newLockEntry?: LockEntry;
}

interface UpdateOptions {
  dryRun?: boolean;
  gitOnly?: boolean;
  registryOnly?: boolean;
  latest?: boolean;
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update installed crafts to newer versions')
    .argument('[craft]', 'Specific craft to update (optional)')
    .option('--dry-run', 'Preview updates without applying')
    .option('--git-only', 'Only update git-based dependencies')
    .option('--registry-only', 'Only update registry dependencies')
    .option('--latest', 'Ignore version constraints, update to latest')
    .action(async (craft, options) => {
      await updateCommand(craft, options);
    });
}

async function updateCommand(craftName: string | undefined, options: UpdateOptions): Promise<void> {
  try {
    // Read craftdesk.json for project info
    const craftDeskJson = await readCraftDeskJson();
    if (!craftDeskJson) {
      logger.error('No craftdesk.json found in current directory');
      process.exit(1);
    }

    // Read lockfile to get installed versions
    const lockfile = await readCraftDeskLock();
    if (!lockfile || !lockfile.crafts || Object.keys(lockfile.crafts).length === 0) {
      logger.warn('No crafts installed. Run "craftdesk install" first.');
      process.exit(0);
    }

    logger.info('Checking for updates...\n');

    // Find available updates
    const updates = await findAvailableUpdates(lockfile, options);

    // Filter to specific craft if provided
    const toUpdate = craftName
      ? updates.filter(u => u.name === craftName || u.name.endsWith(`/${craftName}`))
      : updates;

    if (craftName && toUpdate.length === 0) {
      const inLockfile = Object.keys(lockfile.crafts).find(
        n => n === craftName || n.endsWith(`/${craftName}`)
      );
      if (inLockfile) {
        logger.success(`${craftName} is already up to date!`);
      } else {
        logger.error(`Craft '${craftName}' is not installed.`);
        process.exit(1);
      }
      return;
    }

    if (toUpdate.length === 0) {
      logger.success('All crafts are up to date!');
      return;
    }

    // Display update preview
    displayUpdatePreview(toUpdate);

    if (options.dryRun) {
      logger.info('\nRun without --dry-run to apply updates.');
      return;
    }

    // Perform updates
    logger.info('\nUpdating crafts...\n');

    let successCount = 0;
    let errorCount = 0;

    for (const update of toUpdate) {
      try {
        logger.startSpinner(`Updating ${update.name}...`);

        // Get new lock entry
        const newEntry = await fetchNewLockEntry(update, options.latest);
        if (!newEntry) {
          logger.failSpinner(`Failed to fetch update info for ${update.name}`);
          errorCount++;
          continue;
        }

        // Remove old installation
        const installPath = configManager.getInstallPath();
        const typeDir = installer.getTypeDirectory(update.lockEntry.type);
        const craftDir = path.join(process.cwd(), installPath, typeDir, update.name);

        if (await fs.pathExists(craftDir)) {
          await fs.remove(craftDir);
        }

        // Install new version
        await installer.installCraft(update.name, newEntry);

        // Update lockfile entry
        lockfile.crafts[update.name] = newEntry;

        // Update craftdesk.json dependency if needed
        if (craftDeskJson.dependencies && craftDeskJson.dependencies[update.name]) {
          const currentDep = craftDeskJson.dependencies[update.name];
          // Only update if using exact version or if --latest flag
          const isString = typeof currentDep === 'string';
          const usesCaretRange = isString && currentDep.startsWith('^');

          if (options.latest || !usesCaretRange) {
            if (isString) {
              craftDeskJson.dependencies[update.name] = newEntry.version;
            } else {
              // It's a DependencyConfig - update version field
              (craftDeskJson.dependencies[update.name] as any).version = newEntry.version;
            }
          }
        }

        logger.succeedSpinner(
          `Updated ${update.name}: ${colorize(update.current, 'red')} → ${colorize(newEntry.version, 'green')}`
        );
        successCount++;
      } catch (error: any) {
        logger.failSpinner(`Failed to update ${update.name}: ${error.message}`);
        errorCount++;
      }
    }

    // Update lockfile metadata
    lockfile.generatedAt = new Date().toISOString();
    if (lockfile.metadata) {
      lockfile.metadata.totalCrafts = Object.keys(lockfile.crafts).length;
    }

    // Write updated files
    await writeCraftDeskLock(lockfile);
    await writeCraftDeskJson(craftDeskJson);

    // Summary
    console.log('');
    if (successCount > 0) {
      logger.success(`Updated ${successCount} craft(s)`);
    }
    if (errorCount > 0) {
      logger.warn(`${errorCount} craft(s) failed to update`);
    }

  } catch (error: any) {
    logger.error(`Failed to update: ${error.message}`);
    process.exit(1);
  }
}

async function findAvailableUpdates(
  lockfile: CraftDeskLock,
  options: UpdateOptions
): Promise<UpdateInfo[]> {
  const updates: UpdateInfo[] = [];

  for (const [name, entry] of Object.entries(lockfile.crafts)) {
    const lockEntry = entry as LockEntry;

    // Skip based on options
    if (options.gitOnly && !lockEntry.git) continue;
    if (options.registryOnly && lockEntry.git) continue;

    try {
      let updateInfo: UpdateInfo | null = null;

      if (lockEntry.git) {
        // Git-based dependency
        updateInfo = await checkGitUpdate(name, lockEntry);
      } else {
        // Registry-based dependency
        updateInfo = await checkRegistryUpdate(name, lockEntry);
      }

      if (updateInfo && updateInfo.current !== updateInfo.latest) {
        updates.push(updateInfo);
      }
    } catch (error: any) {
      logger.debug(`Failed to check ${name}: ${error.message}`);
    }
  }

  return updates;
}

async function checkRegistryUpdate(name: string, entry: LockEntry): Promise<UpdateInfo | null> {
  try {
    const craftInfo = await registryClient.getCraftInfo(name);

    if (!craftInfo) {
      logger.debug(`Could not fetch registry info for ${name}`);
      return null;
    }

    const latestVersion = craftInfo.version || 'unknown';
    const currentVersion = entry.version;

    if (latestVersion === 'unknown' || latestVersion === currentVersion) {
      return null;
    }

    return {
      name,
      current: currentVersion,
      latest: latestVersion,
      type: entry.type,
      source: 'registry',
      lockEntry: entry
    };
  } catch (error: any) {
    logger.debug(`Registry check failed for ${name}: ${error.message}`);
    return null;
  }
}

async function checkGitUpdate(name: string, entry: LockEntry): Promise<UpdateInfo | null> {
  if (!entry.git) return null;

  try {
    const gitUrl = entry.git;
    const currentCommit = entry.commit || entry.integrity;
    const currentTag = entry.tag;
    const currentBranch = entry.branch || 'main';

    let latestDisplay = '';
    let hasUpdate = false;

    if (currentTag) {
      // Check for newer tags
      const tags = getRemoteTags(gitUrl);
      if (tags.length > 0) {
        const sortedTags = sortTagsBySemver(tags);
        latestDisplay = sortedTags[0] || currentTag;
        hasUpdate = latestDisplay !== currentTag && isNewerVersion(currentTag, latestDisplay);
      } else {
        return null;
      }
    } else {
      // Check for newer commits on branch
      const latestCommit = getRemoteHeadCommit(gitUrl, currentBranch);
      if (latestCommit && currentCommit) {
        const shortCurrent = currentCommit.substring(0, 7);
        const shortLatest = latestCommit.substring(0, 7);
        latestDisplay = shortLatest;
        hasUpdate = shortCurrent !== shortLatest && latestCommit !== currentCommit;
      } else {
        return null;
      }
    }

    if (!hasUpdate) return null;

    const currentDisplay = currentTag || currentCommit?.substring(0, 7) || 'unknown';

    return {
      name,
      current: currentDisplay,
      latest: latestDisplay,
      type: entry.type,
      source: 'git',
      lockEntry: entry
    };
  } catch (error: any) {
    logger.debug(`Git check failed for ${name}: ${error.message}`);
    return null;
  }
}

async function fetchNewLockEntry(update: UpdateInfo, _latest?: boolean): Promise<LockEntry | null> {
  if (update.source === 'registry') {
    // Fetch from registry
    const craftInfo = await registryClient.getCraftInfo(update.name, update.latest);
    if (!craftInfo) return null;

    return {
      version: craftInfo.version,
      resolved: craftInfo.download_url || update.lockEntry.resolved,
      integrity: craftInfo.integrity || update.lockEntry.integrity,
      type: craftInfo.type,
      author: craftInfo.author,
      registry: update.lockEntry.registry,
      dependencies: craftInfo.dependencies || update.lockEntry.dependencies
    };
  } else {
    // Git source - update tag/commit
    const newEntry: LockEntry = { ...update.lockEntry };

    if (update.lockEntry.tag) {
      // Update to new tag
      newEntry.tag = update.latest;
      newEntry.version = update.latest.replace(/^v/, '');

      // Get commit hash for new tag
      const commit = getRemoteTagCommit(update.lockEntry.git!, update.latest);
      if (commit) {
        newEntry.commit = commit;
        newEntry.integrity = commit;
      }
    } else {
      // Update to new commit
      const branch = update.lockEntry.branch || 'main';
      const latestCommit = getRemoteHeadCommit(update.lockEntry.git!, branch);
      if (latestCommit) {
        newEntry.commit = latestCommit;
        newEntry.integrity = latestCommit;
        newEntry.version = `0.0.0-${latestCommit.substring(0, 7)}`;
      }
    }

    return newEntry;
  }
}

function displayUpdatePreview(updates: UpdateInfo[]): void {
  const nameWidth = Math.max(30, ...updates.map(u => u.name.length + 2));
  const colWidth = 14;

  console.log('');
  console.log(
    padRight('Craft', nameWidth) +
    padRight('Current', colWidth) +
    padRight('Latest', colWidth) +
    'Source'
  );
  console.log('-'.repeat(nameWidth + colWidth * 2 + 10));

  for (const update of updates) {
    const _updateType = getUpdateType(update.current, update.latest);
    const sourceCol = update.source === 'git' ? 'git' : 'registry';

    console.log(
      padRight(update.name, nameWidth) +
      colorize(padRight(update.current, colWidth), 'red') +
      colorize(padRight(update.latest, colWidth), 'green') +
      sourceCol
    );
  }

  console.log('');
  logger.info(`${updates.length} craft(s) can be updated.`);
}

function getRemoteTags(gitUrl: string): string[] {
  try {
    const output = execSync(`git ls-remote --tags ${gitUrl} 2>/dev/null`, {
      encoding: 'utf8',
      timeout: 15000
    });

    const tags: string[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const match = line.match(/refs\/tags\/([^^]+)$/);
      if (match && match[1]) {
        tags.push(match[1]);
      }
    }

    return tags;
  } catch {
    return [];
  }
}

function getRemoteHeadCommit(gitUrl: string, branch: string): string | null {
  try {
    const output = execSync(`git ls-remote ${gitUrl} refs/heads/${branch} 2>/dev/null`, {
      encoding: 'utf8',
      timeout: 15000
    });

    const match = output.match(/^([a-f0-9]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getRemoteTagCommit(gitUrl: string, tag: string): string | null {
  try {
    const output = execSync(`git ls-remote ${gitUrl} refs/tags/${tag} 2>/dev/null`, {
      encoding: 'utf8',
      timeout: 15000
    });

    const match = output.match(/^([a-f0-9]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
