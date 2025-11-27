import { Command } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import { readCraftDeskJson } from '../utils/file-system';
import { logger } from '../utils/logger';
import { registryClient } from '../services/registry-client';
import { configManager } from '../services/config-manager';
import { CraftDeskJson } from '../types/craftdesk-json';

interface PublishOptions {
  access?: 'public' | 'private' | 'organization';
  tag?: string;
  dryRun?: boolean;
}

export function createPublishCommand(): Command {
  return new Command('publish')
    .description('Publish a craft to the registry')
    .argument('[path]', 'Path to craft directory', '.')
    .option('--access <level>', 'Access level: public, private, organization', 'public')
    .option('--tag <tag>', 'Publish with dist-tag (e.g., beta, latest)')
    .option('--dry-run', 'Validate without publishing')
    .action(async (craftPath, options) => {
      await publishCommand(craftPath, options);
    });
}

async function publishCommand(craftPath: string, options: PublishOptions): Promise<void> {
  try {
    // 1. Resolve path
    const fullPath = path.resolve(craftPath);

    if (!await fs.pathExists(fullPath)) {
      logger.error(`Directory not found: ${fullPath}`);
      process.exit(1);
    }

    // 2. Read craftdesk.json from target directory
    const craftJson = await readCraftDeskJson(fullPath);

    if (!craftJson) {
      logger.error('No craftdesk.json found in target directory');
      logger.info('Create a craftdesk.json file or run "craftdesk init" first.');
      process.exit(1);
    }

    // 3. Validate required fields
    const validation = validateCraftJson(craftJson);
    if (!validation.valid) {
      logger.error('Invalid craftdesk.json:');
      validation.errors.forEach(err => logger.error(`  - ${err}`));
      process.exit(1);
    }

    // 4. Collect files first (needed for dry-run)
    const files = await collectCraftFiles(fullPath, craftJson);

    if (files.length === 0) {
      logger.error('No files to publish.');
      process.exit(1);
    }

    // 5. Display preview
    logger.info(`\nPublishing ${craftJson.author}/${craftJson.name}@${craftJson.version}\n`);
    logger.info('Files to publish:');
    files.forEach(f => logger.info(`  ${f.path}`));
    logger.info(`\nTotal: ${files.length} file(s)`);

    // 6. If dry-run, stop here (before auth check)
    if (options.dryRun) {
      logger.success('\nDry run complete. No changes made.');
      logger.info('Run without --dry-run to publish.');
      return;
    }

    // 7. Check registry and authentication (only for actual publish)
    const registryUrl = await configManager.getDefaultRegistry();
    if (!registryUrl) {
      logger.error('No registry configured.');
      logger.info('Add a registry to your craftdesk.json:');
      logger.info('  "registries": { "default": { "url": "https://your-registry.com" } }');
      process.exit(1);
    }

    const token = await configManager.getAuthToken(registryUrl);
    if (!token) {
      logger.error('Not authenticated.');
      logger.info('Run "craftdesk login" first to authenticate with the registry.');
      process.exit(1);
    }

    // 8. Upload version
    logger.startSpinner('Publishing...');

    const result = await registryClient.createVersion(
      craftJson.author!,
      craftJson.name,
      {
        version: craftJson.version,
        type: craftJson.type || 'skill',
        description: craftJson.description,
        main_file: detectMainFile(craftJson),
        files: files
      }
    );

    // 9. Set visibility if public
    if (options.access === 'public') {
      await registryClient.publishCraft(
        craftJson.author!,
        craftJson.name,
        { visibility: 'public' }
      );
    }

    logger.succeedSpinner(`Published ${craftJson.name}@${craftJson.version}`);

    // 9. Display success
    console.log('');
    logger.success('Publication successful!');
    logger.info(`\nView at: ${registryUrl}/crafts/${craftJson.author}/${craftJson.name}`);

    if (result.download_url) {
      logger.info(`Download: ${registryUrl}${result.download_url}`);
    }

  } catch (error: any) {
    logger.failSpinner('Publication failed');
    logger.error(error.message);
    process.exit(1);
  }
}

function validateCraftJson(craftJson: CraftDeskJson): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!craftJson.name) {
    errors.push('Missing required field: name');
  }

  if (!craftJson.version) {
    errors.push('Missing required field: version');
  } else if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(craftJson.version)) {
    errors.push('Version must be in semver format (e.g., 1.0.0)');
  }

  if (!craftJson.author) {
    errors.push('Missing required field: author');
  }

  if (craftJson.type && !['skill', 'agent', 'command', 'hook', 'plugin'].includes(craftJson.type)) {
    errors.push('Invalid type. Must be: skill, agent, command, hook, or plugin');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

async function collectCraftFiles(
  craftPath: string,
  _craftJson: CraftDeskJson
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];

  // File extensions to include
  const includeExtensions = [
    '.md', '.ts', '.js', '.json', '.yaml', '.yml', '.sh', '.py', '.rb'
  ];

  // Directories to exclude
  const excludeDirs = ['node_modules', '.git', 'dist', 'coverage'];

  // Files/patterns to exclude
  const excludeFiles = ['.lock', '.env', '.DS_Store'];

  async function walkDir(dir: string, basePath: string = ''): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = basePath ? path.join(basePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        // Skip excluded directories
        if (excludeDirs.includes(entry.name)) {
          continue;
        }
        await walkDir(fullPath, relativePath);
      } else if (entry.isFile()) {
        // Check if file should be excluded
        const shouldExclude = excludeFiles.some(pattern =>
          entry.name.includes(pattern)
        );
        if (shouldExclude) continue;

        // Check if file extension is included
        const ext = path.extname(entry.name);
        if (!includeExtensions.includes(ext)) continue;

        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          files.push({
            path: relativePath,
            content
          });
        } catch (_error: unknown) {
          logger.warn(`Could not read file: ${relativePath}`);
        }
      }
    }
  }

  await walkDir(craftPath);
  return files;
}

function detectMainFile(craftJson: CraftDeskJson): string {
  const type = craftJson.type || 'skill';

  switch (type) {
    case 'skill':
      return 'SKILL.md';
    case 'agent':
      return 'AGENT.md';
    case 'command':
      return 'command.ts';
    case 'hook':
      return 'hook.ts';
    case 'plugin':
      return 'plugin.json';
    default:
      return 'README.md';
  }
}
