import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { CraftDeskJson } from '../types/craftdesk-json';

/**
 * Global configuration stored in ~/.craftdesk/config.json
 * Used for persistent authentication tokens across sessions
 */
interface GlobalConfig {
  registries: {
    [url: string]: {
      token: string;
      user: string;
    };
  };
  defaultRegistry?: string;
}

/**
 * Manages configuration for the CraftDesk CLI
 *
 * Handles reading craftdesk.json, resolving registry URLs for crafts,
 * managing authentication tokens, and determining installation paths.
 *
 * @example
 * ```typescript
 * const configManager = new ConfigManager();
 * const registry = await configManager.getRegistryForCraft('@company/auth');
 * const token = await configManager.getAuthToken('company-private');
 * ```
 */
export class ConfigManager {
  private craftDeskJson: CraftDeskJson | null = null;
  private globalConfig: GlobalConfig | null = null;

  /**
   * Gets the appropriate registry URL for a given craft
   *
   * Resolution order:
   * 1. Scoped registry matching the craft scope (e.g., @company/craft -> company registry)
   * 2. Default registry from craftdesk.json
   * 3. Global fallback (https://craftdesk.ai)
   *
   * @param craftName - The name of the craft to resolve
   * @returns The registry URL to use for this craft
   *
   * @example
   * ```typescript
   * // Scoped craft with configured registry
   * const url = await configManager.getRegistryForCraft('@company/auth');
   * // Returns: 'https://company.internal'
   *
   * // Regular craft
   * const url = await configManager.getRegistryForCraft('ruby-on-rails');
   * // Returns: 'https://craftdesk.ai' (or default from config)
   * ```
   */
  async getRegistryForCraft(craftName: string): Promise<string> {
    const craftDesk = await this.getCraftDeskJson();

    if (!craftDesk) {
      // Default registry if no craftdesk.json exists
      return 'https://craftdesk.ai';
    }

    // Check if it's a scoped craft and has a configured registry
    if (craftName.startsWith('@') && craftDesk.registries) {
      const scope = craftName.split('/')[0];

      // Look for a registry with matching scope
      for (const [_name, registry] of Object.entries(craftDesk.registries)) {
        if (registry.scope === scope) {
          return registry.url;
        }
      }
    }

    // Check if there's a default registry configured
    if (craftDesk.registries?.default) {
      return craftDesk.registries.default.url;
    }

    // Final fallback
    return 'https://craftdesk.ai';
  }

  /**
   * Retrieves authentication token for a registry
   *
   * Token precedence (first match wins):
   * 1. Environment variable: CRAFTDESK_AUTH_{REGISTRY_NAME_UPPERCASE}
   * 2. Global config file: ~/.craftdesk/config.json
   *
   * Environment variables take precedence to allow CI/CD overrides.
   *
   * @param registryUrl - The URL of the registry (e.g., 'https://craftdesk.ai')
   * @returns The auth token if found, null otherwise
   *
   * @example
   * ```typescript
   * // Check for token (env var or config file)
   * const token = await configManager.getAuthToken('https://craftdesk.ai');
   *
   * // Environment variable override:
   * // export CRAFTDESK_AUTH_DEFAULT=token_abc123
   * ```
   */
  async getAuthToken(registryUrl: string): Promise<string | null> {
    // 1. Check environment variable first (for CI/CD overrides)
    const envVar = `CRAFTDESK_AUTH_${this.getRegistryEnvName(registryUrl)}`;
    if (process.env[envVar]) {
      return process.env[envVar] || null;
    }

    // 2. Check global config file
    const config = await this.loadGlobalConfig();
    return config.registries[registryUrl]?.token || null;
  }

  /**
   * Convert registry URL or name to environment variable name suffix
   * e.g., 'https://craftdesk.ai' -> 'CRAFTDESK_AI'
   * e.g., 'company-private' -> 'COMPANY_PRIVATE'
   */
  private getRegistryEnvName(registryUrl: string): string {
    try {
      const url = new URL(registryUrl);
      return url.hostname.toUpperCase().replace(/[.-]/g, '_');
    } catch {
      // Not a URL - treat as registry name and convert directly
      return registryUrl.toUpperCase().replace(/[.-]/g, '_');
    }
  }

  /**
   * Gets the default registry URL from craftdesk.json
   *
   * @returns The default registry URL, or null if not configured
   */
  async getDefaultRegistry(): Promise<string | null> {
    const craftDesk = await this.getCraftDeskJson();
    return craftDesk?.registries?.default?.url || null;
  }

  /**
   * Resolves a registry identifier to a full URL
   *
   * Handles three cases:
   * 1. Full URL (http:// or https://) - returned as-is
   * 2. Registry name - looked up in craftdesk.json registries section
   * 3. Hostname - prefixed with https://
   *
   * @param registry - A URL, registry name, or hostname
   * @returns The resolved registry URL
   *
   * @example
   * ```typescript
   * // Full URL - returned as-is
   * await configManager.resolveRegistryUrl('https://my-registry.com');
   * // Returns: 'https://my-registry.com'
   *
   * // Registry name from craftdesk.json
   * await configManager.resolveRegistryUrl('company-private');
   * // Returns: 'https://company.internal' (from craftdesk.json)
   *
   * // Hostname - prefixed with https://
   * await configManager.resolveRegistryUrl('my-registry.com');
   * // Returns: 'https://my-registry.com'
   * ```
   */
  async resolveRegistryUrl(registry: string): Promise<string> {
    // If it's already a full URL, use it directly
    if (registry.startsWith('http://') || registry.startsWith('https://')) {
      return registry;
    }

    // Look it up in the craftdesk.json registries section by name
    const craftDeskJson = await this.getCraftDeskJson();
    if (craftDeskJson?.registries?.[registry]) {
      return craftDeskJson.registries[registry].url;
    }

    // Assume it's a hostname without protocol
    return `https://${registry}`;
  }

  /**
   * Returns the installation path for crafts
   *
   * All crafts are installed to the .claude directory in the project root.
   *
   * @returns The relative path to the installation directory
   */
  getInstallPath(): string {
    // Always use .claude directory in project root
    return '.claude';
  }

  /**
   * Reads and caches the craftdesk.json file from the current working directory
   *
   * The file is cached after the first read for performance. Returns null if
   * the file doesn't exist or contains invalid JSON.
   *
   * @returns The parsed craftdesk.json content, or null if not found/invalid
   *
   * @example
   * ```typescript
   * const config = await configManager.getCraftDeskJson();
   * if (config) {
   *   console.log(`Project: ${config.name}@${config.version}`);
   * }
   * ```
   */
  async getCraftDeskJson(): Promise<CraftDeskJson | null> {
    if (this.craftDeskJson) {
      return this.craftDeskJson;
    }

    try {
      const craftDeskPath = path.join(process.cwd(), 'craftdesk.json');
      const content = await fs.readFile(craftDeskPath, 'utf-8');
      this.craftDeskJson = JSON.parse(content);
      return this.craftDeskJson;
    } catch {
      return null;
    }
  }

  // ============================================================
  // Global Configuration Methods (~/.craftdesk/config.json)
  // ============================================================

  /**
   * Gets the path to the global config file
   * @returns Path to ~/.craftdesk/config.json
   */
  getGlobalConfigPath(): string {
    const home = os.homedir();
    return path.join(home, '.craftdesk', 'config.json');
  }

  /**
   * Loads the global configuration from ~/.craftdesk/config.json
   * Returns an empty config if the file doesn't exist
   */
  async loadGlobalConfig(): Promise<GlobalConfig> {
    if (this.globalConfig) {
      return this.globalConfig;
    }

    const configPath = this.getGlobalConfigPath();
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      this.globalConfig = JSON.parse(content);
      return this.globalConfig!;
    } catch {
      // Return empty config if file doesn't exist
      return { registries: {} };
    }
  }

  /**
   * Saves the global configuration to ~/.craftdesk/config.json
   * Creates the .craftdesk directory if it doesn't exist
   */
  async saveGlobalConfig(config: GlobalConfig): Promise<void> {
    const configPath = this.getGlobalConfigPath();
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    this.globalConfig = config;
  }

  /**
   * Sets the authentication token for a registry
   * Saves the token and username to the global config file
   *
   * @param registryUrl - The URL of the registry
   * @param token - The API token to store
   * @param username - The username associated with the token
   */
  async setAuthToken(registryUrl: string, token: string, username: string): Promise<void> {
    const config = await this.loadGlobalConfig();
    config.registries[registryUrl] = { token, user: username };
    await this.saveGlobalConfig(config);
  }

  /**
   * Removes the authentication token for a registry
   *
   * @param registryUrl - The URL of the registry to remove auth for
   * @returns true if a token was removed, false if no token existed
   */
  async removeAuthToken(registryUrl: string): Promise<boolean> {
    const config = await this.loadGlobalConfig();
    if (config.registries[registryUrl]) {
      delete config.registries[registryUrl];
      await this.saveGlobalConfig(config);
      return true;
    }
    return false;
  }

  /**
   * Gets the stored username for a registry
   *
   * @param registryUrl - The URL of the registry
   * @returns The username if found, null otherwise
   */
  async getStoredUsername(registryUrl: string): Promise<string | null> {
    const config = await this.loadGlobalConfig();
    return config.registries[registryUrl]?.user || null;
  }

  /**
   * Clears the cached global config
   * Useful for testing or after external modifications
   */
  clearGlobalConfigCache(): void {
    this.globalConfig = null;
  }
}

export const configManager = new ConfigManager();