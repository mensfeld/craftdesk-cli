import { Command } from 'commander';
import { readCraftDeskJson, readCraftDeskLock, writeCraftDeskLock } from '../utils/file-system';
import { logger } from '../utils/logger';
import { registryClient } from '../services/registry-client';
import { gitResolver } from '../services/git-resolver';
import { installer } from '../services/installer';
import { CraftDeskLock } from '../types/craftdesk-lock';

export function createInstallCommand(): Command {
  return new Command('install')
    .description('Install all dependencies from craftdesk.json')
    .option('--no-lockfile', 'Ignore craftdesk.lock and re-resolve dependencies')
    .option('--production', 'Skip devDependencies')
    .action(async (options) => {
      await installCommand(options);
    });
}

async function installCommand(options: any): Promise<void> {
  try {
    // Read craftdesk.json
    const craftDeskJson = await readCraftDeskJson();
    if (!craftDeskJson) {
      logger.error('No craftdesk.json found in current directory');
      logger.info('Run "craftdesk init" to create one');
      process.exit(1);
    }

    logger.info('Installing dependencies from craftdesk.json...');

    let lockfile: CraftDeskLock | null = null;

    // Check for existing lockfile
    if (!options.noLockfile) {
      lockfile = await readCraftDeskLock();
    }

    if (lockfile) {
      // Install from lockfile
      logger.info('Installing from craftdesk.lock...');
      logger.startSpinner('Installing crafts...');

      await installer.installFromLockfile(lockfile);

      logger.success('Installation complete!');
    } else {
      // Resolve dependencies
      logger.info('No lockfile found. Resolving dependencies...');
      logger.startSpinner('Resolving dependencies...');

      const rawDependencies = craftDeskJson.dependencies || {};

      if (Object.keys(rawDependencies).length === 0) {
        logger.stopSpinner();
        logger.info('No dependencies to install');
        return;
      }

      // Collect all dependencies (including devDependencies if not --production)
      const allDependencies: Record<string, any> = { ...rawDependencies };

      if (!options.production && craftDeskJson.devDependencies) {
        Object.assign(allDependencies, craftDeskJson.devDependencies);
      }

      // Use git resolver which handles both git AND registry dependencies
      const resolution = await gitResolver.resolveAllDependencies(allDependencies);

      if (!resolution) {
        logger.failSpinner('Failed to resolve dependencies');
        process.exit(1);
      }

      logger.succeedSpinner('Dependencies resolved');

      // For registry dependencies that need resolution, fetch their info
      logger.startSpinner('Fetching registry crafts...');

      for (const [name, entry] of Object.entries(resolution.resolved)) {
        if (entry.needsResolution) {
          const craftInfo = await registryClient.getCraftInfo(name, entry.version, entry.registry);
          if (craftInfo) {
            // Require download_url from registry - no defaults for security
            if (!craftInfo.download_url) {
              logger.failSpinner();
              logger.error(`Registry did not provide download URL for ${name}@${craftInfo.version}`);
              process.exit(1);
            }

            resolution.resolved[name] = {
              version: craftInfo.version,
              resolved: craftInfo.download_url,
              integrity: craftInfo.integrity,
              type: craftInfo.type,
              author: craftInfo.author,
              dependencies: craftInfo.dependencies || {}
            };
          } else {
            logger.failSpinner(`Failed to resolve craft: ${name}`);
            process.exit(1);
          }
        }
      }

      logger.succeedSpinner('Registry crafts fetched');

      // Install resolved crafts
      logger.startSpinner('Installing crafts...');

      const newLockfile = resolution.lockfile;
      await installer.installFromLockfile(newLockfile);

      // Save lockfile
      await writeCraftDeskLock(newLockfile);
      logger.success('Created craftdesk.lock');

      logger.success('Installation complete!');
    }

    // Show summary
    const installedCrafts = await installer.listInstalled();
    if (installedCrafts.length > 0) {
      logger.log('\nInstalled crafts:');
      for (const craft of installedCrafts) {
        logger.log(`  • ${craft.name}@${craft.version} (${craft.type})`);
      }
    }
  } catch (error: any) {
    logger.failSpinner();
    logger.error(`Installation failed: ${error.message}`);
    process.exit(1);
  }
}