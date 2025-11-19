#!/usr/bin/env node

import { Command } from 'commander';
import { createInitCommand } from './commands/init';
import { createInstallCommand } from './commands/install';
import { createAddCommand } from './commands/add';
import { createRemoveCommand } from './commands/remove';
import { createListCommand } from './commands/list';
import { createSearchCommand } from './commands/search';
import { createInfoCommand } from './commands/info';
import { logger } from './utils/logger';

const program = new Command();

program
  .name('craftdesk')
  .description('CLI for managing CraftDesk AI capabilities')
  .version('0.3.0', '-v, --version')
  .option('-d, --debug', 'Enable debug output', () => {
    process.env.DEBUG = 'true';
  });

// Add commands
program.addCommand(createInitCommand());
program.addCommand(createInstallCommand());
program.addCommand(createAddCommand());
program.addCommand(createRemoveCommand());
program.addCommand(createListCommand());
program.addCommand(createSearchCommand());
program.addCommand(createInfoCommand());

// Add aliases
program.command('i', { hidden: true }).action(() => {
  program.parse(['', '', 'install', ...process.argv.slice(3)]);
});

// Error handling
program.on('command:*', () => {
  logger.error(`Invalid command: ${program.args.join(' ')}`);
  logger.info('Run "craftdesk --help" for a list of available commands');
  process.exit(1);
});

// Show help if no command provided
if (process.argv.length === 2) {
  logger.log('🚀 CraftDesk CLI');
  logger.log('');
  logger.log('Dependency management for AI capabilities');
  logger.log('');
  logger.log('Getting started:');
  logger.log('  craftdesk init         Create a new craftdesk.json file');
  logger.log('  craftdesk search <q>   Search for crafts in registry');
  logger.log('  craftdesk info <name>  Show craft information');
  logger.log('  craftdesk add <pkg>    Add a new dependency');
  logger.log('  craftdesk install      Install all dependencies');
  logger.log('');
  logger.log('Run "craftdesk --help" for full command list');
  process.exit(0);
}

// Parse command line arguments
program.parse(process.argv);