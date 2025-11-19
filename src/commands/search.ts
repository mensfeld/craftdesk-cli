import { Command } from 'commander';
import { registryClient } from '../services/registry-client';
import { logger } from '../utils/logger';

export function createSearchCommand(): Command {
  return new Command('search')
    .description('Search for crafts in the registry')
    .argument('<query>', 'Search query')
    .option('-t, --type <type>', 'Filter by type (skill, agent, command, hook, plugin)')
    .option('-l, --limit <limit>', 'Maximum number of results', '20')
    .option('--json', 'Output as JSON')
    .action(async (query: string, options) => {
      await searchCommand(query, options);
    });
}

async function searchCommand(query: string, options: any): Promise<void> {
  try {
    logger.startSpinner(`Searching for "${query}"...`);

    const results = await registryClient.searchCrafts(query, options.type);

    if (!results || results.length === 0) {
      logger.failSpinner(`No crafts found matching "${query}"`);
      return;
    }

    logger.succeedSpinner(`Found ${results.length} craft(s)`);

    // Apply limit
    const limit = parseInt(options.limit) || 20;
    const displayResults = results.slice(0, limit);

    if (options.json) {
      console.log(JSON.stringify(displayResults, null, 2));
    } else {
      console.log('');
      for (const craft of displayResults) {
        console.log(`  ${craft.author}/${craft.name}@${craft.version} (${craft.type})`);
        if (craft.description) {
          console.log(`    ${craft.description}`);
        }
        console.log('');
      }

      if (results.length > limit) {
        logger.info(`Showing ${limit} of ${results.length} results. Use --limit to see more.`);
      }

      logger.info(`\nTo install a craft, run: craftdesk add <author>/<name>`);
    }
  } catch (error: any) {
    logger.failSpinner();
    logger.error(`Search failed: ${error.message}`);
    process.exit(1);
  }
}
