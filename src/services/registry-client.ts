import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import path from 'path';
import { configManager } from './config-manager';
import { logger } from '../utils/logger';
import { LockEntry } from '../types/craftdesk-lock';

export interface CraftInfo {
  name: string;
  author: string;
  version: string;
  type: 'skill' | 'agent' | 'command' | 'hook' | 'plugin';
  description?: string;
  dependencies?: Record<string, string>;
  download_url?: string;
  integrity?: string;
}

export interface ResolveResponse {
  resolved: Record<string, any>;
  lockfile: any;
}

export class RegistryClient {
  private axiosInstance: AxiosInstance | null = null;

  private async getClient(registryUrl: string): Promise<AxiosInstance> {
    const token = await configManager.getAuthToken(registryUrl);

    return axios.create({
      baseURL: registryUrl,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      timeout: 30000
    });
  }

  async getCraftInfo(craftName: string, version?: string, registryOverride?: string): Promise<CraftInfo | null> {
    // Get registry URL - can be overridden by dependency-specific registry
    const registryUrl = registryOverride
      ? await this.resolveRegistry(registryOverride)
      : await configManager.getRegistryForCraft(craftName);

    const client = await this.getClient(registryUrl);

    // Parse craft name (could be @scope/name or just name)
    const [author, name] = this.parseCraftName(craftName);

    try {
      const endpoint = version
        ? `/api/v1/crafts/${author}/${name}/versions/${version}`
        : `/api/v1/crafts/${author}/${name}`;

      logger.debug(`Fetching craft info from ${registryUrl}${endpoint}`);

      const response = await client.get(endpoint);
      return response.data.craft || response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.error(`Craft '${craftName}' not found in registry`);
      } else {
        logger.error(`Failed to fetch craft info: ${error.message}`);
      }
      return null;
    }
  }

  private async resolveRegistry(registry: string): Promise<string> {
    // If it's a URL, use it directly
    if (registry.startsWith('http://') || registry.startsWith('https://')) {
      return registry;
    }

    // Look it up in the craftdesk.json registries section
    const craftDeskJson = await configManager.getCraftDeskJson();
    if (craftDeskJson?.registries?.[registry]) {
      return craftDeskJson.registries[registry].url;
    }

    // If not found, assume it's a URL without protocol
    return `https://${registry}`;
  }

  async listVersions(craftName: string): Promise<string[]> {
    const registryUrl = await configManager.getRegistryForCraft(craftName);
    const client = await this.getClient(registryUrl);

    const [author, name] = this.parseCraftName(craftName);

    try {
      const response = await client.get(`/api/v1/crafts/${author}/${name}/versions`);
      return response.data.versions || [];
    } catch (error: any) {
      logger.error(`Failed to fetch versions: ${error.message}`);
      return [];
    }
  }

  async resolveDependencies(dependencies: Record<string, string>): Promise<ResolveResponse | null> {
    // Get the default registry from craftdesk.json
    const craftDesk = await configManager.getCraftDeskJson();
    const registryUrl = craftDesk?.registries?.default?.url;

    // Registry is required only when trying to use registry features
    if (!registryUrl) {
      throw new Error(
        'No registry configured. To use registry-based crafts, add a registry to your craftdesk.json:\n' +
        '{\n' +
        '  "registries": {\n' +
        '    "default": { "url": "https://your-registry.com" }\n' +
        '  }\n' +
        '}\n\n' +
        'Note: Git-based dependencies (GitHub URLs) do not require a registry.'
      );
    }

    const client = await this.getClient(registryUrl);

    try {
      logger.debug('Resolving dependencies via API...');
      const response = await client.post('/api/v1/resolve', { dependencies });
      return response.data;
    } catch (error: any) {
      logger.error(`Failed to resolve dependencies: ${error.message}`);
      return null;
    }
  }

  async downloadCraft(downloadUrl: string, outputPath: string): Promise<void> {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      await fs.promises.mkdir(outputDir, { recursive: true });

      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        maxRedirects: 5
      });

      // Create write stream and pipe response data
      const writer = fs.createWriteStream(outputPath);

      // Wait for download to complete
      await new Promise<void>((resolve, reject) => {
        // Handle errors from both the response stream and the write stream
        response.data.on('error', (err: Error) => reject(err));
        writer.on('error', (err: Error) => reject(err));
        writer.on('finish', () => resolve());

        // Start piping after handlers are set
        response.data.pipe(writer);
      });

      logger.debug(`Downloaded craft archive to ${outputPath}`);
    } catch (error: any) {
      throw new Error(`Failed to download craft: ${error.message}`);
    }
  }

  async searchCrafts(query: string, type?: string): Promise<CraftInfo[]> {
    // Get the default registry from craftdesk.json
    const craftDesk = await configManager.getCraftDeskJson();
    const registryUrl = craftDesk?.registries?.default?.url;

    // Registry is required for search
    if (!registryUrl) {
      throw new Error(
        'No registry configured. To search for crafts, add a registry to your craftdesk.json:\n' +
        '{\n' +
        '  "registries": {\n' +
        '    "default": { "url": "https://your-registry.com" }\n' +
        '  }\n' +
        '}\n\n' +
        'Note: You can still add Git-based dependencies without a registry using GitHub URLs.'
      );
    }

    const client = await this.getClient(registryUrl);

    try {
      const params: any = { q: query };
      if (type) params.type = type;

      const response = await client.get('/api/v1/crafts', { params });
      return response.data.crafts || [];
    } catch (error: any) {
      logger.error(`Failed to search crafts: ${error.message}`);
      return [];
    }
  }

  private parseCraftName(craftName: string): [string, string] {
    // Handle author/name format (e.g., "john/rails-api")
    if (craftName.includes('/') && !craftName.startsWith('@')) {
      const parts = craftName.split('/');
      // Validate exactly 2 non-empty parts
      if (parts.length === 2 && parts[0] && parts[1]) {
        return [parts[0], parts[1]];
      }
    }

    // Handle scoped format: @author/name
    if (craftName.startsWith('@')) {
      const parts = craftName.substring(1).split('/');
      // Validate exactly 2 non-empty parts
      if (parts.length === 2 && parts[0] && parts[1]) {
        return [parts[0], parts[1]];
      }
    }

    // For unscoped names without author, throw error
    // Users must specify author/name format for registry crafts
    throw new Error(
      `Invalid craft name format: "${craftName}". ` +
      `Registry crafts must use "author/name" format with non-empty author and name (e.g., "john/rails-api")`
    );
  }
}

export const registryClient = new RegistryClient();