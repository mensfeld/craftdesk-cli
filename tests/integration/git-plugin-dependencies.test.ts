/**
 * Integration tests for git-based plugin resolution with dependencies
 *
 * Tests:
 * 1. Git plugin without dependencies
 * 2. Git plugin with registry dependencies
 * 3. Git plugin with nested git dependencies
 * 4. Component embedding and registration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { GitResolver } from '../../src/services/git-resolver';
import { PluginResolver } from '../../src/services/plugin-resolver';
import { installer } from '../../src/services/installer';
import { settingsManager } from '../../src/services/settings-manager';

const TEST_DIR = path.join(__dirname, '../fixtures/git-plugin-test');
const INSTALL_DIR = path.join(TEST_DIR, '.claude');

describe('Git Plugin Dependency Resolution', () => {
  let gitResolver: GitResolver;
  let pluginResolver: PluginResolver;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();

    // Clean up test directory
    await fs.remove(TEST_DIR);
    await fs.ensureDir(TEST_DIR);
    await fs.ensureDir(INSTALL_DIR);

    // Change to test directory so installer installs there
    process.chdir(TEST_DIR);

    // Initialize services
    gitResolver = new GitResolver();
    pluginResolver = new PluginResolver();
  });

  afterEach(async () => {
    // Restore original cwd
    process.chdir(originalCwd);

    // Clean up
    await fs.remove(TEST_DIR);
  });

  describe('Git Plugin Without Dependencies', () => {
    it('should resolve and install git plugin with no dependencies', async () => {
      // Create mock git repository
      const repoPath = path.join(TEST_DIR, 'simple-plugin-repo');
      await createMockGitPlugin(repoPath, {
        name: 'simple-git-plugin',
        version: '1.0.0',
        hasDependencies: false,
        hasComponents: true
      });

      // Resolve git dependency
      const gitInfo = {
        url: repoPath,
        branch: 'main'
      };

      const resolved = await gitResolver.resolveGitDependency(gitInfo);

      // Verify resolution
      expect(resolved.url).toBe(repoPath);
      expect(resolved.resolvedCommit).toBeDefined();

      // Install plugin
      const pluginDir = path.join(INSTALL_DIR, 'plugins', 'simple-git-plugin');
      const lockEntry = {
        version: '1.0.0',
        git: resolved.url,
        commit: resolved.resolvedCommit,
        integrity: `sha256-git:${resolved.resolvedCommit}`,
        type: 'plugin',
        author: 'test',
        dependencies: {}
      };

      await installer.installCraft('simple-git-plugin', lockEntry);

      // Verify installation
      expect(await fs.pathExists(pluginDir)).toBe(true);
      expect(await fs.pathExists(path.join(pluginDir, '.claude-plugin', 'plugin.json'))).toBe(true);
      expect(await fs.pathExists(path.join(pluginDir, 'craftdesk.json'))).toBe(true);
      expect(await fs.pathExists(path.join(pluginDir, 'skills', 'test-skill', 'SKILL.md'))).toBe(true);

      // Verify settings registration
      const settings = await settingsManager.readSettings();
      expect(settings.plugins['simple-git-plugin']).toBeDefined();
      expect(settings.plugins['simple-git-plugin'].components?.skills).toContain('test-skill');
    });
  });

  describe('Git Plugin With Registry Dependencies', () => {
    it('should resolve git plugin with registry dependencies', async () => {
      // Create mock git repository with dependencies in craftdesk.json
      const repoPath = path.join(TEST_DIR, 'plugin-with-deps-repo');
      await createMockGitPlugin(repoPath, {
        name: 'git-plugin-with-deps',
        version: '2.0.0',
        hasDependencies: true,
        dependencies: {
          'auth-plugin': '^1.0.0',
          'logger-plugin': '^2.1.0'
        },
        hasComponents: true
      });

      // Resolve git dependency
      const gitInfo = {
        url: repoPath,
        branch: 'main'
      };

      const resolved = await gitResolver.resolveGitDependency(gitInfo);

      // Install plugin
      const pluginDir = path.join(INSTALL_DIR, 'plugins', 'git-plugin-with-deps');
      const lockEntry = {
        version: '2.0.0',
        git: resolved.url,
        commit: resolved.resolvedCommit,
        integrity: `sha256-git:${resolved.resolvedCommit}`,
        type: 'plugin',
        author: 'test',
        dependencies: {
          'auth-plugin': '^1.0.0',
          'logger-plugin': '^2.1.0'
        }
      };

      await installer.installCraft('git-plugin-with-deps', lockEntry);

      // Verify plugin was installed
      expect(await fs.pathExists(pluginDir)).toBe(true);

      // Verify craftdesk.json has dependencies
      const craftdeskJson = await fs.readJson(path.join(pluginDir, 'craftdesk.json'));
      expect(craftdeskJson.dependencies).toEqual({
        'auth-plugin': '^1.0.0',
        'logger-plugin': '^2.1.0'
      });

      // Resolve plugin dependencies (would trigger registry fetches in real scenario)
      await pluginResolver.resolvePluginDependencies(pluginDir);
      const flattenedDeps = pluginResolver.getFlattenedDependencies();

      // Verify dependencies were discovered
      expect(flattenedDeps['auth-plugin']).toBe('^1.0.0');
      expect(flattenedDeps['logger-plugin']).toBe('^2.1.0');

      // Verify plugin tree
      const pluginTree = pluginResolver.buildPluginTree();
      expect(pluginTree['git-plugin-with-deps']).toBeDefined();
      expect(pluginTree['git-plugin-with-deps'].dependencies).toContain('auth-plugin');
      expect(pluginTree['git-plugin-with-deps'].dependencies).toContain('logger-plugin');
    });
  });

  describe('Git Plugin With Nested Git Dependencies', () => {
    it('should resolve git plugin with nested git dependencies', async () => {
      // Create dependency plugin (git repo 1)
      const depRepoPath = path.join(TEST_DIR, 'dependency-plugin-repo');
      await createMockGitPlugin(depRepoPath, {
        name: 'dependency-plugin',
        version: '1.5.0',
        hasDependencies: false,
        hasComponents: true
      });

      // Create main plugin that depends on the first (git repo 2)
      const mainRepoPath = path.join(TEST_DIR, 'main-plugin-repo');
      await createMockGitPlugin(mainRepoPath, {
        name: 'main-git-plugin',
        version: '3.0.0',
        hasDependencies: true,
        dependencies: {
          'dependency-plugin': {
            git: depRepoPath,
            branch: 'main'
          }
        },
        hasComponents: true
      });

      // Resolve main plugin
      const mainGitInfo = {
        url: mainRepoPath,
        branch: 'main'
      };

      const mainResolved = await gitResolver.resolveGitDependency(mainGitInfo);

      // Install main plugin
      const mainPluginDir = path.join(INSTALL_DIR, 'plugins', 'main-git-plugin');
      const mainLockEntry = {
        version: '3.0.0',
        git: mainResolved.url,
        commit: mainResolved.resolvedCommit,
        integrity: `sha256-git:${mainResolved.resolvedCommit}`,
        type: 'plugin',
        author: 'test',
        dependencies: {
          'dependency-plugin': {
            git: depRepoPath,
            branch: 'main'
          }
        }
      };

      await installer.installCraft('main-git-plugin', mainLockEntry);

      // Verify main plugin installed
      expect(await fs.pathExists(mainPluginDir)).toBe(true);

      // Read craftdesk.json to verify git dependency
      const craftdeskJson = await fs.readJson(path.join(mainPluginDir, 'craftdesk.json'));
      expect(craftdeskJson.dependencies['dependency-plugin']).toBeDefined();
      expect(craftdeskJson.dependencies['dependency-plugin'].git).toBe(depRepoPath);

      // Resolve nested dependencies
      await pluginResolver.resolvePluginDependencies(mainPluginDir);
      const flattenedDeps = pluginResolver.getFlattenedDependencies();

      // Verify nested git dependency was discovered
      expect(flattenedDeps['dependency-plugin']).toBeDefined();
      expect((flattenedDeps['dependency-plugin'] as any).git).toBe(depRepoPath);

      // Now install the dependency plugin
      const depResolved = await gitResolver.resolveGitDependency({
        url: depRepoPath,
        branch: 'main'
      });

      const depPluginDir = path.join(INSTALL_DIR, 'plugins', 'dependency-plugin');
      const depLockEntry = {
        version: '1.5.0',
        git: depResolved.url,
        commit: depResolved.resolvedCommit,
        integrity: `sha256-git:${depResolved.resolvedCommit}`,
        type: 'plugin',
        author: 'test',
        dependencies: {},
        installedAs: 'dependency' as const
      };

      await installer.installCraft('dependency-plugin', depLockEntry);

      // Verify dependency plugin installed
      expect(await fs.pathExists(depPluginDir)).toBe(true);

      // Verify both plugins registered in settings
      const settings = await settingsManager.readSettings();
      expect(settings.plugins['main-git-plugin']).toBeDefined();
      expect(settings.plugins['dependency-plugin']).toBeDefined();
      expect(settings.plugins['dependency-plugin'].isDependency).toBe(true);
    });
  });

  describe('Component Embedding and Registration', () => {
    it('should correctly embed and register components from git plugins', async () => {
      // Create git plugin with multiple component types
      const repoPath = path.join(TEST_DIR, 'full-plugin-repo');
      await createMockGitPlugin(repoPath, {
        name: 'full-git-plugin',
        version: '1.0.0',
        hasDependencies: false,
        hasComponents: true,
        componentTypes: ['skills', 'agents', 'commands']
      });

      // Resolve and install
      const gitInfo = { url: repoPath, branch: 'main' };
      const resolved = await gitResolver.resolveGitDependency(gitInfo);

      const pluginDir = path.join(INSTALL_DIR, 'plugins', 'full-git-plugin');
      const lockEntry = {
        version: '1.0.0',
        git: resolved.url,
        commit: resolved.resolvedCommit,
        integrity: `sha256-git:${resolved.resolvedCommit}`,
        type: 'plugin',
        author: 'test',
        dependencies: {}
      };

      await installer.installCraft('full-git-plugin', lockEntry);

      // Verify all component directories exist
      expect(await fs.pathExists(path.join(pluginDir, 'skills', 'test-skill'))).toBe(true);
      expect(await fs.pathExists(path.join(pluginDir, 'agents', 'test-agent'))).toBe(true);
      expect(await fs.pathExists(path.join(pluginDir, 'commands', 'test-command.md'))).toBe(true);

      // Verify .claude-plugin/plugin.json exists
      const pluginJson = await fs.readJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'));
      expect(pluginJson.name).toBe('full-git-plugin');

      // Verify settings registration with component scanning
      const settings = await settingsManager.readSettings();
      const plugin = settings.plugins['full-git-plugin'];

      expect(plugin).toBeDefined();
      expect(plugin.components?.skills).toContain('test-skill');
      expect(plugin.components?.agents).toContain('test-agent');
      expect(plugin.components?.commands).toContain('test-command.md');
    });

    it('should merge manifest components with scanned components', async () => {
      // Create plugin with partial component declaration in plugin.json
      const repoPath = path.join(TEST_DIR, 'partial-manifest-repo');
      await createMockGitPlugin(repoPath, {
        name: 'partial-manifest-plugin',
        version: '1.0.0',
        hasDependencies: false,
        hasComponents: true,
        componentTypes: ['skills', 'agents'],
        manifestComponents: {
          skills: ['test-skill']  // Only declare skill, not agent
        }
      });

      // Resolve and install
      const gitInfo = { url: repoPath, branch: 'main' };
      const resolved = await gitResolver.resolveGitDependency(gitInfo);

      const pluginDir = path.join(INSTALL_DIR, 'plugins', 'partial-manifest-plugin');
      const lockEntry = {
        version: '1.0.0',
        git: resolved.url,
        commit: resolved.resolvedCommit,
        integrity: `sha256-git:${resolved.resolvedCommit}`,
        type: 'plugin',
        author: 'test',
        dependencies: {}
      };

      await installer.installCraft('partial-manifest-plugin', lockEntry);

      // Verify settings registration
      const settings = await settingsManager.readSettings();
      const plugin = settings.plugins['partial-manifest-plugin'];

      // Manifest takes precedence for skills
      expect(plugin.components?.skills).toEqual(['test-skill']);

      // Agent should be scanned (not in manifest)
      expect(plugin.components?.agents).toContain('test-agent');
    });
  });
});

/**
 * Helper: Create mock git plugin repository
 */
async function createMockGitPlugin(repoPath: string, options: {
  name: string;
  version: string;
  hasDependencies: boolean;
  dependencies?: Record<string, string | any>;
  hasComponents?: boolean;
  componentTypes?: string[];
  manifestComponents?: any;
}) {
  const {
    name,
    version,
    hasDependencies,
    dependencies = {},
    hasComponents = false,
    componentTypes = ['skills'],
    manifestComponents
  } = options;

  // Create directory
  await fs.ensureDir(repoPath);

  // Initialize git repo
  execSync('git init', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: repoPath, stdio: 'pipe' });

  // Create .claude-plugin/plugin.json
  const claudePluginDir = path.join(repoPath, '.claude-plugin');
  await fs.ensureDir(claudePluginDir);

  const pluginJson = {
    name,
    version,
    description: `Test plugin ${name}`,
    author: 'Test Author',
    license: 'MIT',
    ...(manifestComponents && { components: manifestComponents })
  };

  await fs.writeJson(path.join(claudePluginDir, 'plugin.json'), pluginJson, { spaces: 2 });

  // Create craftdesk.json
  const craftdeskJson: any = {
    name,
    version,
    type: 'plugin'
  };

  if (hasDependencies && Object.keys(dependencies).length > 0) {
    craftdeskJson.dependencies = dependencies;
  }

  await fs.writeJson(path.join(repoPath, 'craftdesk.json'), craftdeskJson, { spaces: 2 });

  // Create components if requested
  if (hasComponents) {
    for (const compType of componentTypes) {
      const compDir = path.join(repoPath, compType);
      await fs.ensureDir(compDir);

      if (compType === 'skills') {
        const skillDir = path.join(compDir, 'test-skill');
        await fs.ensureDir(skillDir);
        await fs.writeFile(
          path.join(skillDir, 'SKILL.md'),
          '# Test Skill\n\nTest skill content.'
        );
      } else if (compType === 'agents') {
        const agentDir = path.join(compDir, 'test-agent');
        await fs.ensureDir(agentDir);
        await fs.writeFile(
          path.join(agentDir, 'AGENT.md'),
          '# Test Agent\n\nTest agent content.'
        );
      } else if (compType === 'commands') {
        await fs.writeFile(
          path.join(compDir, 'test-command.md'),
          '# Test Command\n\nTest command content.'
        );
      }
    }
  }

  // Create README
  await fs.writeFile(
    path.join(repoPath, 'README.md'),
    `# ${name}\n\nTest plugin repository.`
  );

  // Git add and commit
  execSync('git add .', { cwd: repoPath, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: repoPath, stdio: 'pipe' });
  execSync('git branch -M main', { cwd: repoPath, stdio: 'pipe' });
}
