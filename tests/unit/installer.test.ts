import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Installer } from '../../src/services/installer';
import { createTempDir, cleanupTempDir } from '../helpers/test-utils';
import path from 'path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';

// Mock dependencies
vi.mock('axios');
vi.mock('adm-zip');
vi.mock('child_process', () => ({
  execSync: vi.fn()
}));
vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    updateSpinner: vi.fn(),
    succeedSpinner: vi.fn(),
    failSpinner: vi.fn()
  }
}));
vi.mock('../../src/utils/crypto', () => ({
  verifyFileChecksum: vi.fn(),
  formatChecksum: vi.fn((hash) => hash.substring(0, 12)),
  calculateFileChecksum: vi.fn()
}));

describe('Installer', () => {
  let installer: Installer;
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    installer = new Installer();
    tempDir = await createTempDir('installer-test-');
    originalCwd = process.cwd();
    process.chdir(tempDir);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanupTempDir(tempDir);
  });

  describe('getTypeDirectory', () => {
    it('should return correct directory for skill type', () => {
      const result = (installer as any).getTypeDirectory('skill');
      expect(result).toBe('skills');
    });

    it('should return correct directory for agent type', () => {
      const result = (installer as any).getTypeDirectory('agent');
      expect(result).toBe('agents');
    });

    it('should return correct directory for command type', () => {
      const result = (installer as any).getTypeDirectory('command');
      expect(result).toBe('commands');
    });

    it('should return correct directory for hook type', () => {
      const result = (installer as any).getTypeDirectory('hook');
      expect(result).toBe('hooks');
    });

    it('should default to crafts for unknown type', () => {
      const result = (installer as any).getTypeDirectory('unknown' as any);
      expect(result).toBe('crafts');
    });
  });

  describe('createMetadata', () => {
    it('should create craftdesk-metadata.json file', async () => {
      const fs = await import('fs-extra');
      const craftDir = path.join(tempDir, '.claude', 'skills', 'test-craft');
      await fs.ensureDir(craftDir);

      const entry = {
        version: '1.0.0',
        resolved: 'https://craftdesk.ai/download',
        integrity: 'sha256-test',
        type: 'skill' as const,
        author: 'test-author',
        dependencies: {}
      };

      await (installer as any).createMetadata(craftDir, 'test-craft', entry);

      const metadataPath = path.join(craftDir, '.craftdesk-metadata.json');
      const exists = await fs.pathExists(metadataPath);
      expect(exists).toBe(true);

      const metadata = await fs.readJson(metadataPath);
      expect(metadata.name).toBe('test-craft');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.type).toBe('skill');
      expect(metadata.installedAt).toBeDefined();
    });
  });

  describe('installFromLockfile', () => {
    it('should handle empty lockfile', async () => {
      const lockfile = {
        version: '1.0.0',
        lockfileVersion: 1,
        crafts: {}
      };

      await expect(installer.installFromLockfile(lockfile)).resolves.not.toThrow();
    });

    it('should create install directory structure', async () => {
      const lockfile = {
        version: '1.0.0',
        lockfileVersion: 1,
        crafts: {}
      };

      await installer.installFromLockfile(lockfile);

      const installDir = path.join(tempDir, '.claude');
      const exists = await fs.pathExists(installDir);
      expect(exists).toBe(true);
    });

    it('should install multiple crafts sequentially', async () => {
      const axios = await import('axios');
      const { verifyFileChecksum } = await import('../../src/utils/crypto');

      // Mock successful downloads and verifications
      (axios.default as any).mockResolvedValue({
        data: {
          pipe: vi.fn(),
          on: vi.fn()
        }
      });
      (verifyFileChecksum as any).mockResolvedValue(true);

      // Mock AdmZip extraction
      const mockExtract = vi.fn();
      (AdmZip as any).mockImplementation(function() {
        return { extractAllTo: mockExtract };
      });

      const lockfile = {
        version: '1.0.0',
        lockfileVersion: 1,
        crafts: {
          'author1/craft1': {
            version: '1.0.0',
            resolved: 'https://registry.com/craft1.zip',
            integrity: 'sha256-abc123',
            type: 'skill' as const,
            author: 'author1',
            dependencies: {}
          },
          'author2/craft2': {
            version: '2.0.0',
            resolved: 'https://registry.com/craft2.zip',
            integrity: 'sha256-def456',
            type: 'agent' as const,
            author: 'author2',
            dependencies: {}
          }
        }
      };

      // Mock the file writing by creating a writable stream mock
      const mockWriteStream = {
        on: vi.fn((event, handler) => {
          if (event === 'finish') {
            setTimeout(() => handler(), 0);
          }
          return mockWriteStream;
        })
      };
      vi.spyOn(fs, 'createWriteStream').mockReturnValue(mockWriteStream as any);

      await installer.installFromLockfile(lockfile);

      expect(mockExtract).toHaveBeenCalledTimes(2);
      expect(verifyFileChecksum).toHaveBeenCalledTimes(2);
    });

    it('should fail fast if craft installation fails', async () => {
      const axios = await import('axios');
      (axios.default as any).mockRejectedValue(new Error('Download failed'));

      const lockfile = {
        version: '1.0.0',
        lockfileVersion: 1,
        crafts: {
          'author/craft': {
            version: '1.0.0',
            resolved: 'https://registry.com/craft.zip',
            integrity: 'sha256-abc',
            type: 'skill' as const,
            author: 'author',
            dependencies: {}
          }
        }
      };

      await expect(installer.installFromLockfile(lockfile)).rejects.toThrow('Download failed');
    });
  });

  describe('installCraft', () => {
    describe('registry source', () => {
      it('should download, verify, and extract archive', async () => {
        const axios = await import('axios');
        const { verifyFileChecksum } = await import('../../src/utils/crypto');

        // Mock successful download
        const mockWriteStream = {
          on: vi.fn((event, handler) => {
            if (event === 'finish') {
              setTimeout(() => handler(), 0);
            }
            return mockWriteStream;
          })
        };
        vi.spyOn(fs, 'createWriteStream').mockReturnValue(mockWriteStream as any);

        (axios.default as any).mockResolvedValue({
          data: {
            pipe: vi.fn()
          }
        });

        // Mock checksum verification
        (verifyFileChecksum as any).mockResolvedValue(true);

        // Mock ZIP extraction
        const mockExtract = vi.fn();
        (AdmZip as any).mockImplementation(function() {
          return { extractAllTo: mockExtract };
        });

        const entry = {
          version: '1.0.0',
          resolved: 'https://registry.com/craft.zip',
          integrity: 'sha256-abc123def456',
          type: 'skill' as const,
          author: 'test-author',
          dependencies: {}
        };

        await installer.installCraft('test-craft', entry);

        // Verify download was called
        expect(axios.default).toHaveBeenCalledWith({
          method: 'GET',
          url: 'https://registry.com/craft.zip',
          responseType: 'stream'
        });

        // Verify checksum was verified
        expect(verifyFileChecksum).toHaveBeenCalled();

        // Verify extraction happened
        expect(mockExtract).toHaveBeenCalled();

        // Verify metadata was created
        const metadataPath = path.join(tempDir, '.claude', 'skills', 'test-craft', '.craftdesk-metadata.json');
        const metadata = await fs.readJson(metadataPath);
        expect(metadata.name).toBe('test-craft');
        expect(metadata.version).toBe('1.0.0');
        expect(metadata.type).toBe('skill');
      });

      it('should fail on checksum mismatch', async () => {
        const axios = await import('axios');
        const { verifyFileChecksum } = await import('../../src/utils/crypto');

        // Mock successful download
        const mockWriteStream = {
          on: vi.fn((event, handler) => {
            if (event === 'finish') {
              setTimeout(() => handler(), 0);
            }
            return mockWriteStream;
          })
        };
        vi.spyOn(fs, 'createWriteStream').mockReturnValue(mockWriteStream as any);

        (axios.default as any).mockResolvedValue({
          data: {
            pipe: vi.fn()
          }
        });

        // Mock failed checksum verification
        (verifyFileChecksum as any).mockResolvedValue(false);

        const entry = {
          version: '1.0.0',
          resolved: 'https://registry.com/craft.zip',
          integrity: 'sha256-expected',
          type: 'skill' as const,
          author: 'test-author',
          dependencies: {}
        };

        await expect(
          installer.installCraft('test-craft', entry)
        ).rejects.toThrow('Checksum verification failed');
      });

      it('should warn when checksum missing', async () => {
        const axios = await import('axios');
        const { logger } = await import('../../src/utils/logger');

        // Mock successful download
        const mockWriteStream = {
          on: vi.fn((event, handler) => {
            if (event === 'finish') {
              setTimeout(() => handler(), 0);
            }
            return mockWriteStream;
          })
        };
        vi.spyOn(fs, 'createWriteStream').mockReturnValue(mockWriteStream as any);

        (axios.default as any).mockResolvedValue({
          data: {
            pipe: vi.fn()
          }
        });

        // Mock ZIP extraction
        const mockExtract = vi.fn();
        (AdmZip as any).mockImplementation(function() {
          return { extractAllTo: mockExtract };
        });

        const entry = {
          version: '1.0.0',
          resolved: 'https://registry.com/craft.zip',
          // No integrity field
          type: 'skill' as const,
          author: 'test-author',
          dependencies: {}
        };

        await installer.installCraft('test-craft', entry);

        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('No checksum available')
        );
      });

      it('should clean up archive after extraction', async () => {
        const axios = await import('axios');
        const { verifyFileChecksum } = await import('../../src/utils/crypto');

        // Mock successful download
        const mockWriteStream = {
          on: vi.fn((event, handler) => {
            if (event === 'finish') {
              setTimeout(() => handler(), 0);
            }
            return mockWriteStream;
          })
        };
        vi.spyOn(fs, 'createWriteStream').mockReturnValue(mockWriteStream as any);

        (axios.default as any).mockResolvedValue({
          data: {
            pipe: vi.fn()
          }
        });

        (verifyFileChecksum as any).mockResolvedValue(true);

        const mockExtract = vi.fn();
        (AdmZip as any).mockImplementation(function() {
          return { extractAllTo: mockExtract };
        });

        const entry = {
          version: '1.0.0',
          resolved: 'https://registry.com/craft.zip',
          integrity: 'sha256-abc',
          type: 'skill' as const,
          author: 'test-author',
          dependencies: {}
        };

        await installer.installCraft('test-craft', entry);

        // Verify archive.zip was removed
        const archivePath = path.join(tempDir, '.claude', 'skills', 'test-craft', 'archive.zip');
        const exists = await fs.pathExists(archivePath);
        expect(exists).toBe(false);
      });

      it('should handle download errors', async () => {
        const axios = await import('axios');
        (axios.default as any).mockRejectedValue(new Error('Network error'));

        const entry = {
          version: '1.0.0',
          resolved: 'https://registry.com/craft.zip',
          integrity: 'sha256-abc',
          type: 'skill' as const,
          author: 'test-author',
          dependencies: {}
        };

        await expect(
          installer.installCraft('test-craft', entry)
        ).rejects.toThrow('Network error');
      });

      it('should handle extraction errors', async () => {
        const axios = await import('axios');
        const { verifyFileChecksum } = await import('../../src/utils/crypto');

        // Mock successful download
        const mockWriteStream = {
          on: vi.fn((event, handler) => {
            if (event === 'finish') {
              setTimeout(() => handler(), 0);
            }
            return mockWriteStream;
          })
        };
        vi.spyOn(fs, 'createWriteStream').mockReturnValue(mockWriteStream as any);

        (axios.default as any).mockResolvedValue({
          data: {
            pipe: vi.fn()
          }
        });

        (verifyFileChecksum as any).mockResolvedValue(true);

        // Mock failed extraction
        (AdmZip as any).mockImplementation(function() {
          return {
            extractAllTo: vi.fn(() => {
              throw new Error('Corrupt archive');
            })
          };
        });

        const entry = {
          version: '1.0.0',
          resolved: 'https://registry.com/craft.zip',
          integrity: 'sha256-abc',
          type: 'skill' as const,
          author: 'test-author',
          dependencies: {}
        };

        await expect(
          installer.installCraft('test-craft', entry)
        ).rejects.toThrow('Failed to extract archive');
      });
    });

    // NOTE: Git source tests are skipped because they require complex mocking
    // of child_process.execSync and actual git commands. These will be covered
    // by integration tests instead.
    describe.skip('git source', () => {
      it('git installation is tested via integration tests', () => {
        // Placeholder for git tests
        // See tests/integration/git-resolver.test.ts for comprehensive git tests
        expect(true).toBe(true);
      });
    });

    describe('craft type routing', () => {
      it('should install skills to skills directory', async () => {
        const axios = await import('axios');
        const { verifyFileChecksum } = await import('../../src/utils/crypto');

        const mockWriteStream = {
          on: vi.fn((event, handler) => {
            if (event === 'finish') {
              setTimeout(() => handler(), 0);
            }
            return mockWriteStream;
          })
        };
        vi.spyOn(fs, 'createWriteStream').mockReturnValue(mockWriteStream as any);

        (axios.default as any).mockResolvedValue({ data: { pipe: vi.fn() } });
        (verifyFileChecksum as any).mockResolvedValue(true);

        const mockExtract = vi.fn();
        (AdmZip as any).mockImplementation(function() {
          return { extractAllTo: mockExtract };
        });

        const entry = {
          version: '1.0.0',
          resolved: 'https://registry.com/craft.zip',
          integrity: 'sha256-abc',
          type: 'skill' as const,
          author: 'author',
          dependencies: {}
        };

        await installer.installCraft('test-craft', entry);

        const skillDir = path.join(tempDir, '.claude', 'skills', 'test-craft');
        const exists = await fs.pathExists(skillDir);
        expect(exists).toBe(true);
      });

      it('should install agents to agents directory', async () => {
        const axios = await import('axios');
        const { verifyFileChecksum } = await import('../../src/utils/crypto');

        const mockWriteStream = {
          on: vi.fn((event, handler) => {
            if (event === 'finish') {
              setTimeout(() => handler(), 0);
            }
            return mockWriteStream;
          })
        };
        vi.spyOn(fs, 'createWriteStream').mockReturnValue(mockWriteStream as any);

        (axios.default as any).mockResolvedValue({ data: { pipe: vi.fn() } });
        (verifyFileChecksum as any).mockResolvedValue(true);

        const mockExtract = vi.fn();
        (AdmZip as any).mockImplementation(function() {
          return { extractAllTo: mockExtract };
        });

        const entry = {
          version: '1.0.0',
          resolved: 'https://registry.com/agent.zip',
          integrity: 'sha256-def',
          type: 'agent' as const,
          author: 'author',
          dependencies: {}
        };

        await installer.installCraft('test-agent', entry);

        const agentDir = path.join(tempDir, '.claude', 'agents', 'test-agent');
        const exists = await fs.pathExists(agentDir);
        expect(exists).toBe(true);
      });

      it('should install commands to commands directory', async () => {
        const axios = await import('axios');
        const { verifyFileChecksum } = await import('../../src/utils/crypto');

        const mockWriteStream = {
          on: vi.fn((event, handler) => {
            if (event === 'finish') {
              setTimeout(() => handler(), 0);
            }
            return mockWriteStream;
          })
        };
        vi.spyOn(fs, 'createWriteStream').mockReturnValue(mockWriteStream as any);

        (axios.default as any).mockResolvedValue({ data: { pipe: vi.fn() } });
        (verifyFileChecksum as any).mockResolvedValue(true);

        const mockExtract = vi.fn();
        (AdmZip as any).mockImplementation(function() {
          return { extractAllTo: mockExtract };
        });

        const entry = {
          version: '1.0.0',
          resolved: 'https://registry.com/command.zip',
          integrity: 'sha256-ghi',
          type: 'command' as const,
          author: 'author',
          dependencies: {}
        };

        await installer.installCraft('test-command', entry);

        const commandDir = path.join(tempDir, '.claude', 'commands', 'test-command');
        const exists = await fs.pathExists(commandDir);
        expect(exists).toBe(true);
      });
    });
  });

  describe('removeCraft', () => {
    it('should remove installed craft', async () => {
      // Create a craft directory
      const craftDir = path.join(tempDir, '.claude', 'skills', 'test-craft');
      await fs.ensureDir(craftDir);
      await fs.writeFile(path.join(craftDir, '.craftdesk-metadata.json'), '{}');

      await installer.removeCraft('test-craft', 'skill');

      const exists = await fs.pathExists(craftDir);
      expect(exists).toBe(false);
    });

    it('should handle removing non-existent craft', async () => {
      const { logger } = await import('../../src/utils/logger');

      await installer.removeCraft('nonexistent', 'skill');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('is not installed')
      );
    });
  });

  describe('listInstalled', () => {
    it('should list all installed crafts', async () => {
      // Create multiple crafts
      const skill1Dir = path.join(tempDir, '.claude', 'skills', 'skill1');
      await fs.ensureDir(skill1Dir);
      await fs.writeJson(path.join(skill1Dir, '.craftdesk-metadata.json'), {
        name: 'skill1',
        version: '1.0.0',
        type: 'skill'
      });

      const agent1Dir = path.join(tempDir, '.claude', 'agents', 'agent1');
      await fs.ensureDir(agent1Dir);
      await fs.writeJson(path.join(agent1Dir, '.craftdesk-metadata.json'), {
        name: 'agent1',
        version: '2.0.0',
        type: 'agent'
      });

      const installed = await installer.listInstalled();

      expect(installed).toHaveLength(2);
      expect(installed).toContainEqual({ name: 'skill1', version: '1.0.0', type: 'skill' });
      expect(installed).toContainEqual({ name: 'agent1', version: '2.0.0', type: 'agent' });
    });

    it('should return empty array when nothing installed', async () => {
      const installed = await installer.listInstalled();

      expect(installed).toEqual([]);
    });

    it('should handle missing type directories', async () => {
      // Create install dir but no type subdirectories
      await fs.ensureDir(path.join(tempDir, '.claude'));

      const installed = await installer.listInstalled();

      expect(installed).toEqual([]);
    });
  });
});
