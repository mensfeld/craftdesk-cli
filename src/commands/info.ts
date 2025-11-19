import { Command } from 'commander';
import { registryClient } from '../services/registry-client';
import { logger } from '../utils/logger';

export function createInfoCommand(): Command {
  return new Command('info')
    .description('Show detailed information about a craft')
    .argument('<craft>', 'Craft name (author/name format)')
    .option('--json', 'Output as JSON')
    .action(async (craftName: string, options) => {
      await infoCommand(craftName, options);
    });
}

async function infoCommand(craftName: string, options: any): Promise<void> {
  try {
    logger.startSpinner(`Fetching info for ${craftName}...`);

    const craftInfo = await registryClient.getCraftInfo(craftName);

    if (!craftInfo) {
      logger.failSpinner(`Craft '${craftName}' not found in registry`);
      process.exit(1);
    }

    logger.succeedSpinner(`Found ${craftInfo.author}/${craftInfo.name}`);

    if (options.json) {
      console.log(JSON.stringify(craftInfo, null, 2));
    } else {
      console.log('');
      console.log(`  Name: ${craftInfo.author}/${craftInfo.name}`);
      console.log(`  Version: ${craftInfo.version}`);
      console.log(`  Type: ${craftInfo.type}`);

      if (craftInfo.description) {
        console.log(`  Description: ${craftInfo.description}`);
      }

      // Fetch available versions
      logger.startSpinner('Fetching available versions...');
      const versions = await registryClient.listVersions(craftName);
      logger.succeedSpinner('');

      if (versions && versions.length > 0) {
        console.log(`  Available versions: ${versions.join(', ')}`);
      }

      if (craftInfo.dependencies && Object.keys(craftInfo.dependencies).length > 0) {
        console.log('\n  Dependencies:');
        for (const [dep, version] of Object.entries(craftInfo.dependencies)) {
          console.log(`    - ${dep}: ${version}`);
        }
      }

      console.log('');
      console.log(`To install: craftdesk add ${craftInfo.author}/${craftInfo.name}`);
      console.log(`To install specific version: craftdesk add ${craftInfo.author}/${craftInfo.name}@${craftInfo.version}`);
    }
  } catch (error: any) {
    logger.failSpinner();
    logger.error(`Failed to get craft info: ${error.message}`);
    process.exit(1);
  }
}
