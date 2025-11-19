import { Command } from 'commander';
import path from 'path';
import { readCraftDeskJson, writeCraftDeskJson, readCraftDeskLock, writeCraftDeskLock } from '../utils/file-system';
import { logger } from '../utils/logger';
import { registryClient } from '../services/registry-client';
import { installer } from '../services/installer';
import { gitResolver } from '../services/git-resolver';
import { calculateFileChecksum } from '../utils/crypto';
import fs from 'fs-extra';
import os from 'os';

export function createAddCommand(): Command {
  return new Command('add')
    .description('Add a new dependency and install it')
    .argument('<craft>', 'Craft name (e.g., ruby-on-rails or @acme/patterns)')
    .option('-D, --save-dev', 'Save as devDependency')
    .option('-O, --save-optional', 'Save as optionalDependency')
    .option('-E, --save-exact', 'Save exact version')
    .option('-t, --type <type>', 'Specify craft type (skill, agent, command, hook, plugin)')
    .action(async (craftArg: string, options) => {
      await addCommand(craftArg, options);
    });
}

async function addCommand(craftArg: string, options: any): Promise<void> {
  try {
    // Read craftdesk.json
    const craftDeskJson = await readCraftDeskJson();
    if (!craftDeskJson) {
      logger.error('No craftdesk.json found in current directory');
      logger.info('Run "craftdesk init" to create one');
      process.exit(1);
    }

    // Parse craft name and version
    let craftName: string;
    let versionConstraint: string = '*';

    if (craftArg.includes('@') && !craftArg.startsWith('@')) {
      // Format: craft@version
      const parts = craftArg.split('@');
      craftName = parts[0];
      versionConstraint = parts[1];
    } else if (craftArg.startsWith('@')) {
      // Scoped craft: @scope/craft or @scope/craft@version
      const afterScope = craftArg.substring(craftArg.indexOf('/') + 1);
      if (afterScope.includes('@')) {
        const parts = craftArg.split('@');
        craftName = `${parts[0]}@${parts[1]}`;
        versionConstraint = parts[2];
      } else {
        craftName = craftArg;
      }
    } else {
      craftName = craftArg;
    }

    logger.info(`Adding ${craftName}...`);

    // Check if this is a git dependency
    let depValue: string | any;
    let lockEntry: any;
    let displayInfo: string;

    // Convert GitHub web URLs to git URLs automatically
    const normalizedArg = normalizeGitHubUrl(craftArg);

    if (normalizedArg.startsWith('git+') || normalizedArg.includes('.git')) {
      // Handle git dependency
      logger.startSpinner('Analyzing git dependency...');

      const gitInfo = parseGitUrl(normalizedArg);

      // Resolve the git dependency to get its craftdesk.json and dependencies
      const resolvedGit = await gitResolver.resolveGitDependency({
        url: gitInfo.url,
        branch: gitInfo.branch,
        tag: gitInfo.tag,
        commit: gitInfo.commit,
        path: gitInfo.path,
        file: gitInfo.file
      });

      depValue = {
        git: gitInfo.url,
        ...(gitInfo.branch && { branch: gitInfo.branch }),
        ...(gitInfo.tag && { tag: gitInfo.tag }),
        ...(gitInfo.path && { path: gitInfo.path }),
        ...(gitInfo.file && { file: gitInfo.file })
      };

      // Use resolved information for the lock entry
      const craftJson = resolvedGit.craftDeskJson;

      // Determine type: explicit option > craftdesk.json > inferred > default
      const craftType = options.type || craftJson?.type || 'skill';

      lockEntry = {
        version: craftJson?.version || gitInfo.tag || gitInfo.branch || 'HEAD',
        resolved: gitInfo.url,
        integrity: resolvedGit.resolvedCommit || 'git',
        type: craftType,
        author: craftJson?.author || 'git',
        git: gitInfo.url,
        ...(gitInfo.branch && { branch: gitInfo.branch }),
        ...(gitInfo.tag && { tag: gitInfo.tag }),
        ...(resolvedGit.resolvedCommit && { commit: resolvedGit.resolvedCommit }),
        ...(gitInfo.path && { path: gitInfo.path }),
        ...(gitInfo.file && { file: gitInfo.file }),
        dependencies: craftJson?.dependencies || {}
      };

      craftName = craftJson?.name || gitInfo.name || path.basename(gitInfo.url, '.git');
      displayInfo = `${craftName}@${craftJson?.version || 'git'} from ${gitInfo.url}`;
      logger.succeedSpinner(`Resolved git dependency: ${displayInfo}`);
    } else {
      // Regular registry dependency
      logger.startSpinner('Fetching craft information...');

      // Check if the dependency has custom registry info in craftdesk.json
      let registryOverride: string | undefined;
      const existingDep = craftDeskJson.dependencies?.[craftName];
      if (existingDep && typeof existingDep === 'object' && 'registry' in existingDep) {
        registryOverride = existingDep.registry;
      }

      // Get craft info from registry
      const craftInfo = await registryClient.getCraftInfo(craftName, undefined, registryOverride);
      if (!craftInfo) {
        logger.failSpinner(`Craft '${craftName}' not found`);
        process.exit(1);
      }

      logger.succeedSpinner(`Found ${craftInfo.name}@${craftInfo.version}`);

      const version = options.saveExact ? craftInfo.version : versionConstraint;
      depValue = version;

      // Require download_url from API - no localhost fallback for security
      if (!craftInfo.download_url) {
        logger.failSpinner();
        logger.error(`Registry did not provide download URL for ${craftInfo.author}/${craftInfo.name}@${craftInfo.version}`);
        logger.error('The registry may be misconfigured or the craft version is incomplete.');
        process.exit(1);
      }

      const downloadUrl = craftInfo.download_url;

      // Calculate checksum if not provided by API
      let integrity = craftInfo.integrity;
      if (!integrity) {
        logger.startSpinner('Computing checksum for security verification...');
        const tempDir = path.join(os.tmpdir(), 'craftdesk-verify');
        const tempFile = path.join(tempDir, `${craftInfo.name}-${craftInfo.version}.zip`);

        try {
          await fs.ensureDir(tempDir);
          // Download to temp location
          await registryClient.downloadCraft(downloadUrl, tempFile);
          // Calculate checksum
          integrity = await calculateFileChecksum(tempFile);
          logger.succeedSpinner(`Checksum computed: ${integrity.substring(0, 12)}...`);
        } finally {
          // Clean up temp file and directory
          await fs.remove(tempFile).catch(() => {});  // Ignore errors if file doesn't exist
          await fs.remove(tempDir).catch(() => {});   // Ignore errors if directory doesn't exist
        }
      }

      lockEntry = {
        version: craftInfo.version,
        resolved: downloadUrl,
        integrity: integrity,
        type: craftInfo.type,
        author: craftInfo.author,
        dependencies: craftInfo.dependencies || {}
      };

      displayInfo = `${craftInfo.name}@${craftInfo.version}`;
    }

    // Determine which dependency field to use
    let depField: string;
    if (options.saveDev) {
      depField = 'devDependencies';
    } else if (options.saveOptional) {
      depField = 'optionalDependencies';
    } else {
      depField = 'dependencies';
    }

    // Initialize field if it doesn't exist
    if (!craftDeskJson[depField]) {
      craftDeskJson[depField] = {};
    }

    // Add to craftdesk.json
    craftDeskJson[depField][craftName] = depValue;

    // Save craftdesk.json
    await writeCraftDeskJson(craftDeskJson);

    const displayVersion = typeof depValue === 'string' ? depValue : (depValue.tag || depValue.branch || 'git');
    logger.success(`Added ${craftName}@${displayVersion} to ${depField}`);

    // Install the craft
    logger.startSpinner(`Installing ${craftName}...`);

    await installer.installCraft(craftName, lockEntry);

    logger.succeedSpinner(`Installed ${displayInfo}`);

    // Update craftdesk.lock
    let lockfile = await readCraftDeskLock();
    if (!lockfile) {
      lockfile = {
        version: '1.0.0',
        lockfileVersion: 1,
        generatedAt: new Date().toISOString(),
        crafts: {}
      };
    }

    // Add or update the craft in the lockfile
    lockfile.crafts[craftName] = lockEntry;
    await writeCraftDeskLock(lockfile);

    logger.success('Craft added successfully!');
  } catch (error: any) {
    logger.failSpinner();
    logger.error(`Failed to add craft: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Converts GitHub web URLs to git URL format
 *
 * Supported GitHub URL formats:
 * - https://github.com/user/repo/tree/branch/path/to/dir
 * - https://github.com/user/repo/blob/branch/path/to/file.md
 * - https://github.com/user/repo (assumes main branch)
 *
 * @param url - The GitHub URL (web or git format)
 * @returns Normalized git URL with #branch#path: or #branch#file: syntax
 * @private
 */
function normalizeGitHubUrl(url: string): string {
  // Already in git+ format, return as-is
  if (url.startsWith('git+')) {
    return url;
  }

  // Already a .git URL, return as-is
  if (url.endsWith('.git') || url.includes('.git#')) {
    return url;
  }

  // Check if it's a GitHub web URL
  const githubTreeMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/);
  const githubBlobMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  const githubRepoMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);

  if (githubTreeMatch) {
    // Tree URL: directory reference
    const [, owner, repo, branch, path] = githubTreeMatch;
    return `git+https://github.com/${owner}/${repo}.git#${branch}#path:${path}`;
  } else if (githubBlobMatch) {
    // Blob URL: file reference
    const [, owner, repo, branch, file] = githubBlobMatch;
    return `git+https://github.com/${owner}/${repo}.git#${branch}#file:${file}`;
  } else if (githubRepoMatch) {
    // Repo URL without tree/blob: clone entire repo
    const [, owner, repo] = githubRepoMatch;
    return `git+https://github.com/${owner}/${repo}.git`;
  }

  // Not a recognized GitHub URL, return as-is
  return url;
}

/**
 * Parses a git URL with optional ref and subdirectory/file specifiers
 *
 * Supported formats:
 * - git+https://github.com/user/repo.git#branch
 * - git+https://github.com/user/repo.git#v1.0.0
 * - git+https://github.com/user/repo.git#commit-hash
 * - git+https://github.com/user/repo.git#path:subfolder/skill
 * - git+https://github.com/user/repo.git#file:skill.md
 * - git+https://github.com/user/repo.git#main#file:rspec-agent.md
 * - https://github.com/user/repo.git
 *
 * @param urlString - The git URL to parse
 * @returns Parsed git dependency information
 * @private
 */
function parseGitUrl(urlString: string): any {
  // Remove optional git+ prefix (npm-style format)
  let url = urlString.replace(/^git\+/, '');

  const result: any = {};

  // Extract direct file path (e.g., #file:rspec-agent.md)
  if (url.includes('#file:')) {
    const [baseUrl, filePart] = url.split('#file:');
    url = baseUrl;
    result.file = filePart;
  }

  // Extract subdirectory path for monorepos (e.g., #path:crafts/auth)
  if (url.includes('#path:')) {
    const [baseUrl, pathPart] = url.split('#path:');
    url = baseUrl;
    result.path = pathPart;
  }

  // Extract git reference (branch/tag/commit)
  // Must be parsed after path and file to avoid conflicts
  if (url.includes('#') && !url.includes('#path:') && !url.includes('#file:')) {
    const [baseUrl, ref] = url.split('#');
    url = baseUrl;

    // Heuristic to determine ref type:
    // - Tags typically start with 'v' or match semver pattern (1.0.0)
    if (ref.startsWith('v') || /^\d+\.\d+/.test(ref)) {
      result.tag = ref;
    }
    // - Commit hashes are 40-character hex strings
    else if (ref.length === 40 && /^[a-f0-9]+$/.test(ref)) {
      result.commit = ref;
    }
    // - Otherwise, assume it's a branch name
    else {
      result.branch = ref;
    }
  }

  result.url = url;

  // Extract repository name from URL for display purposes
  const match = url.match(/\/([^/]+?)(\.git)?$/);
  if (match) {
    result.name = match[1];
  }

  return result;
}