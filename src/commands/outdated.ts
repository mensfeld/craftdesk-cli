import { Command } from 'commander';
import { execSync } from 'child_process';
import { readCraftDeskJson, readCraftDeskLock } from '../utils/file-system';
import { logger } from '../utils/logger';
import { registryClient } from '../services/registry-client';
import { LockEntry } from '../types/craftdesk-lock';
import {
  isNewerVersion,
  sortTagsBySemver,
  getUpdateType,
  padRight,
  colorize
} from '../utils/version-utils';

interface OutdatedInfo {
  name: string;
  current: string;
  wanted: string;
  latest: string;
  type: string;
  source: 'registry' | 'git';
  hasUpdate: boolean;
  updateType?: 'major' | 'minor' | 'patch' | 'commit';
}

export function createOutdatedCommand(): Command {
  return new Command('outdated')
    .description('Check for newer versions of installed crafts')
    .option('--json', 'Output as JSON')
    .option('--git-only', 'Only check git-based dependencies')
    .option('--registry-only', 'Only check registry-based dependencies')
    .action(async (options) => {
      await outdatedCommand(options);
    });
}

async function outdatedCommand(options: any): Promise<void> {
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

    if (!options.json) {
      logger.info('Checking for updates...\n');
    }

    const outdatedList: OutdatedInfo[] = [];
    const crafts = lockfile.crafts;

    // Check each installed craft
    for (const [name, entry] of Object.entries(crafts)) {
      const lockEntry = entry as LockEntry;

      // Skip based on options
      if (options.gitOnly && !lockEntry.git) continue;
      if (options.registryOnly && lockEntry.git) continue;

      try {
        let outdatedInfo: OutdatedInfo | null = null;

        if (lockEntry.git) {
          // Git-based dependency
          outdatedInfo = await checkGitUpdate(name, lockEntry);
        } else {
          // Registry-based dependency
          outdatedInfo = await checkRegistryUpdate(name, lockEntry);
        }

        if (outdatedInfo) {
          outdatedList.push(outdatedInfo);
        }
      } catch (error: any) {
        logger.debug(`Failed to check ${name}: ${error.message}`);
      }
    }

    // Output results
    if (options.json) {
      console.log(JSON.stringify(outdatedList, null, 2));
      return;
    }

    // Filter to only show crafts with updates
    const withUpdates = outdatedList.filter(o => o.hasUpdate);

    if (withUpdates.length === 0) {
      logger.success('All crafts are up to date!');
      return;
    }

    // Display table header
    const nameWidth = Math.max(25, ...withUpdates.map(o => o.name.length + 2));
    const colWidth = 14;

    console.log('');
    console.log(
      padRight('Craft', nameWidth) +
      padRight('Current', colWidth) +
      padRight('Wanted', colWidth) +
      padRight('Latest', colWidth) +
      'Source'
    );
    console.log('-'.repeat(nameWidth + colWidth * 3 + 10));

    // Display each outdated craft
    for (const info of withUpdates) {
      const sourceCol = info.source === 'git' ? 'git' : 'registry';

      // Display with colors (alignment uses plain text)
      console.log(
        padRight(info.name, nameWidth) +
        colorize(padRight(info.current, colWidth), 'red') +
        colorize(padRight(info.wanted, colWidth), 'yellow') +
        colorize(padRight(info.latest, colWidth), 'green') +
        sourceCol
      );
    }

    console.log('');
    logger.info(`${withUpdates.length} craft(s) have updates available.`);
    logger.info('Run "craftdesk install" to update to wanted versions.');
    logger.info('Run "craftdesk add <craft>@latest" to update to latest version.');

  } catch (error: any) {
    logger.error(`Failed to check for updates: ${error.message}`);
    process.exit(1);
  }
}

async function checkRegistryUpdate(name: string, entry: LockEntry): Promise<OutdatedInfo | null> {
  try {
    // Get craft info from registry
    const craftInfo = await registryClient.getCraftInfo(name);

    if (!craftInfo) {
      logger.debug(`Could not fetch registry info for ${name}`);
      return {
        name,
        current: entry.version,
        wanted: entry.version,
        latest: 'unknown',
        type: entry.type,
        source: 'registry',
        hasUpdate: false
      };
    }

    const latestVersion = craftInfo.version || 'unknown';
    const currentVersion = entry.version;

    // Compare versions
    const hasUpdate = latestVersion !== 'unknown' && latestVersion !== currentVersion;

    return {
      name,
      current: currentVersion,
      wanted: latestVersion,  // For now, wanted = latest (semver resolution would be more complex)
      latest: latestVersion,
      type: entry.type,
      source: 'registry',
      hasUpdate,
      updateType: hasUpdate ? getUpdateType(currentVersion, latestVersion) : undefined
    };
  } catch (error: any) {
    logger.debug(`Registry check failed for ${name}: ${error.message}`);
    return null;
  }
}

async function checkGitUpdate(name: string, entry: LockEntry): Promise<OutdatedInfo | null> {
  if (!entry.git) return null;

  try {
    const gitUrl = entry.git;
    const currentCommit = entry.commit || entry.integrity;
    const currentTag = entry.tag;
    const currentBranch = entry.branch || 'main';

    let _latestRef = '';
    let latestDisplay = '';
    let hasUpdate = false;

    if (currentTag) {
      // Check for newer tags
      const tags = getRemoteTags(gitUrl);
      if (tags.length > 0) {
        // Sort tags by semver if possible, otherwise alphabetically
        const sortedTags = sortTagsBySemver(tags);
        latestDisplay = sortedTags[0] || currentTag;
        hasUpdate = latestDisplay !== currentTag && isNewerVersion(currentTag, latestDisplay);
      } else {
        latestDisplay = currentTag;
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
        latestDisplay = currentCommit?.substring(0, 7) || 'unknown';
      }
    }

    const currentDisplay = currentTag || currentCommit?.substring(0, 7) || 'unknown';

    return {
      name,
      current: currentDisplay,
      wanted: latestDisplay,
      latest: latestDisplay,
      type: entry.type,
      source: 'git',
      hasUpdate,
      updateType: hasUpdate ? 'commit' : undefined
    };
  } catch (error: any) {
    logger.debug(`Git check failed for ${name}: ${error.message}`);
    return {
      name,
      current: entry.tag || entry.commit?.substring(0, 7) || entry.version,
      wanted: 'unknown',
      latest: 'unknown',
      type: entry.type,
      source: 'git',
      hasUpdate: false
    };
  }
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
      // Extract tag name from refs/tags/tagname
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

// Export git helper functions for testing
export function getRemoteTagsExported(gitUrl: string): string[] {
  return getRemoteTags(gitUrl);
}

export function getRemoteHeadCommitExported(gitUrl: string, branch: string): string | null {
  return getRemoteHeadCommit(gitUrl, branch);
}
