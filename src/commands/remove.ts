import { Command } from 'commander';
import { readCraftDeskJson, writeCraftDeskJson, readCraftDeskLock, writeCraftDeskLock } from '../utils/file-system';
import { logger } from '../utils/logger';
import { installer } from '../services/installer';

export function createRemoveCommand(): Command {
  return new Command('remove')
    .description('Remove a dependency')
    .argument('<craft>', 'Craft name to remove')
    .option('-f, --force', 'Force removal even if other crafts depend on it')
    .action(async (craftName: string, options: any) => {
      await removeCommand(craftName, options);
    });
}

async function removeCommand(craftName: string, options: any = {}): Promise<void> {
  try {
    // Read craftdesk.json
    const craftDeskJson = await readCraftDeskJson();
    if (!craftDeskJson) {
      logger.error('No craftdesk.json found in current directory');
      process.exit(1);
    }

    // Read lockfile to check for dependencies
    const lockfile = await readCraftDeskLock();

    // Check if other plugins depend on this craft
    if (lockfile?.pluginTree && !options.force) {
      const dependents: string[] = [];

      for (const [pluginName, pluginInfo] of Object.entries(lockfile.pluginTree)) {
        if (pluginInfo.dependencies?.includes(craftName)) {
          dependents.push(`${pluginName}@${pluginInfo.version}`);
        }
      }

      if (dependents.length > 0) {
        logger.warn(`Warning: ${craftName} is required by:`);
        for (const dep of dependents) {
          logger.warn(`  - ${dep}`);
        }
        logger.log('');
        logger.info('Use --force to remove anyway');
        process.exit(1);
      }
    }

    // Check if craft exists in any dependency field
    let found = false;
    let foundInField: string | null = null;

    const depFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

    for (const field of depFields) {
      if (craftDeskJson[field] && craftDeskJson[field][craftName]) {
        found = true;
        foundInField = field;
        delete craftDeskJson[field][craftName];

        // Remove empty objects
        if (Object.keys(craftDeskJson[field]).length === 0) {
          delete craftDeskJson[field];
        }
        break;
      }
    }

    if (!found) {
      logger.error(`Craft '${craftName}' is not in craftdesk.json`);
      process.exit(1);
    }

    // Save updated craftdesk.json
    await writeCraftDeskJson(craftDeskJson);
    logger.success(`Removed ${craftName} from ${foundInField}`);

    // Update lockfile if it exists
    if (lockfile && lockfile.crafts[craftName]) {
      const craftEntry = lockfile.crafts[craftName];

      // Remove from file system
      await installer.removeCraft(craftName, craftEntry.type);

      // Remove from lockfile
      delete lockfile.crafts[craftName];

      // Clean up plugin tree in lockfile
      if (lockfile.pluginTree && lockfile.pluginTree[craftName]) {
        delete lockfile.pluginTree[craftName];
      }

      // Update requiredBy for other plugins
      if (lockfile.pluginTree) {
        for (const [_pluginName, pluginInfo] of Object.entries(lockfile.pluginTree)) {
          if (pluginInfo.requiredBy) {
            pluginInfo.requiredBy = pluginInfo.requiredBy.filter(dep => dep !== craftName);
          }
          if (pluginInfo.dependencies) {
            pluginInfo.dependencies = pluginInfo.dependencies.filter(dep => dep !== craftName);
          }
        }
      }

      // Save updated lockfile
      await writeCraftDeskLock(lockfile);
      logger.success('Updated craftdesk.lock');
    } else {
      // Try to remove from file system anyway (best effort)
      const typesToTry = ['skill', 'agent', 'command', 'hook', 'plugin'];
      for (const type of typesToTry) {
        await installer.removeCraft(craftName, type);
      }
    }

    logger.success('Craft removed successfully!');
  } catch (error: any) {
    logger.error(`Failed to remove craft: ${error.message}`);
    process.exit(1);
  }
}