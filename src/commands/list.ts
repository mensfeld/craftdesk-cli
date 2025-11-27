import { Command } from 'commander';
import { readCraftDeskJson, readCraftDeskLock } from '../utils/file-system';
import { logger } from '../utils/logger';
import { installer } from '../services/installer';

export function createListCommand(): Command {
  return new Command('list')
    .description('List installed crafts')
    .option('--tree', 'Show dependency tree')
    .option('--depth <n>', 'Limit tree depth', parseInt)
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await listCommand(options);
    });
}

async function listCommand(options: any): Promise<void> {
  try {
    // Read craftdesk.json for project info
    const craftDeskJson = await readCraftDeskJson();
    if (!craftDeskJson) {
      logger.error('No craftdesk.json found in current directory');
      process.exit(1);
    }

    // Get installed crafts
    const installedCrafts = await installer.listInstalled();

    if (options.json) {
      // JSON output
      console.log(JSON.stringify({
        name: craftDeskJson.name,
        version: craftDeskJson.version,
        installedCrafts
      }, null, 2));
      return;
    }

    // Display project info
    logger.log(`${craftDeskJson.name}@${craftDeskJson.version}`);

    if (installedCrafts.length === 0) {
      logger.info('No crafts installed');
      logger.info('Run "craftdesk install" to install dependencies');
      return;
    }

    if (options.tree) {
      // Show dependency tree
      const lockfile = await readCraftDeskLock();
      if (!lockfile) {
        logger.warn('No craftdesk.lock found. Cannot show dependency tree.');
        logger.info('Run "craftdesk install" to generate lockfile');
      } else {
        displayDependencyTree(lockfile, options.depth);
      }
    } else {
      // Group crafts by type
      const lockfile = await readCraftDeskLock();
      const pluginTree = lockfile?.pluginTree || {};

      const plugins = installedCrafts.filter(c => c.type === 'plugin');
      const skills = installedCrafts.filter(c => c.type === 'skill');
      const agents = installedCrafts.filter(c => c.type === 'agent');
      const commands = installedCrafts.filter(c => c.type === 'command');
      const hooks = installedCrafts.filter(c => c.type === 'hook');
      const others = installedCrafts.filter(c => !['plugin', 'skill', 'agent', 'command', 'hook'].includes(c.type));

      // Show plugins with their dependencies
      if (plugins.length > 0) {
        logger.log('\n🔌 Plugins:');
        for (const plugin of plugins) {
          const treeInfo = pluginTree[plugin.name];
          const isDep = treeInfo?.isDependency;
          const suffix = isDep ? ' (dependency)' : '';

          logger.log(`  ${plugin.name}@${plugin.version}${suffix}`);

          // Show dependencies
          if (treeInfo?.dependencies && treeInfo.dependencies.length > 0) {
            for (let i = 0; i < treeInfo.dependencies.length; i++) {
              const dep = treeInfo.dependencies[i];
              const isLast = i === treeInfo.dependencies.length - 1;
              const connector = isLast ? '└──' : '├──';
              logger.log(`    ${connector} ${dep}`);
            }
          }
        }
      }

      // Show skills
      if (skills.length > 0) {
        logger.log('\n📚 Skills:');
        for (const skill of skills) {
          logger.log(`  ${skill.name}@${skill.version}`);
        }
      }

      // Show agents
      if (agents.length > 0) {
        logger.log('\n🤖 Agents:');
        for (const agent of agents) {
          logger.log(`  ${agent.name}@${agent.version}`);
        }
      }

      // Show commands
      if (commands.length > 0) {
        logger.log('\n⚡ Commands:');
        for (const cmd of commands) {
          logger.log(`  ${cmd.name}@${cmd.version}`);
        }
      }

      // Show hooks
      if (hooks.length > 0) {
        logger.log('\n🔗 Hooks:');
        for (const hook of hooks) {
          logger.log(`  ${hook.name}@${hook.version}`);
        }
      }

      // Show others
      if (others.length > 0) {
        logger.log('\n📦 Others:');
        for (const other of others) {
          logger.log(`  ${other.name}@${other.version} (${other.type})`);
        }
      }

      logger.log('');
      logger.info(`Total: ${installedCrafts.length} crafts installed`);
    }
  } catch (error: any) {
    logger.error(`Failed to list crafts: ${error.message}`);
    process.exit(1);
  }
}

function _getTypeIcon(type: string): string {
  switch (type) {
    case 'skill':
      return '📚';
    case 'agent':
      return '🤖';
    case 'command':
      return '⚡';
    case 'hook':
      return '🔗';
    case 'plugin':
      return '🔌';
    default:
      return '📦';
  }
}

function displayDependencyTree(lockfile: any, maxDepth?: number): void {
  logger.log('\nDependency tree:');

  if (!lockfile.tree) {
    logger.warn('No dependency tree information in lockfile');
    return;
  }

  const tree = lockfile.tree;
  const depth = 0;
  const prefix = '';

  for (const [key, value] of Object.entries(tree)) {
    displayTreeNode(key, value, depth, maxDepth || Infinity, prefix, Object.keys(tree).indexOf(key) === Object.keys(tree).length - 1);
  }
}

function displayTreeNode(key: string, node: any, depth: number, maxDepth: number, prefix: string, isLast: boolean): void {
  if (depth > maxDepth) return;

  const connector = isLast ? '└── ' : '├── ';
  const [name, version] = key.split('@');

  logger.log(`${prefix}${connector}${name}@${version}`);

  if (typeof node === 'object' && node.dependencies && depth < maxDepth) {
    const newPrefix = prefix + (isLast ? '    ' : '│   ');
    const deps = Object.entries(node.dependencies);

    deps.forEach(([depKey, depValue], index) => {
      const isLastDep = index === deps.length - 1;
      displayTreeNode(depKey, depValue, depth + 1, maxDepth, newPrefix, isLastDep);
    });
  } else if (typeof node === 'string' && node === '(shared)') {
    // Shared dependency indicator
    logger.log(' (shared)');
  }
}