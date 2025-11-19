import crypto from 'crypto';
import fs from 'fs-extra';

/**
 * Calculate SHA-256 checksum of a file
 *
 * @param filePath - Path to the file
 * @returns Promise resolving to hex-encoded SHA-256 hash
 */
export async function calculateFileChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => {
      hash.update(data);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Verify file checksum matches expected value
 *
 * @param filePath - Path to the file to verify
 * @param expectedChecksum - Expected SHA-256 hash (hex-encoded)
 * @returns Promise resolving to true if match, false otherwise
 */
export async function verifyFileChecksum(filePath: string, expectedChecksum: string): Promise<boolean> {
  const actualChecksum = await calculateFileChecksum(filePath);
  return actualChecksum.toLowerCase() === expectedChecksum.toLowerCase();
}

/**
 * Format checksum for display (first 12 chars)
 *
 * @param checksum - Full checksum string
 * @returns Shortened checksum for display
 */
export function formatChecksum(checksum: string): string {
  return checksum.substring(0, 12);
}
