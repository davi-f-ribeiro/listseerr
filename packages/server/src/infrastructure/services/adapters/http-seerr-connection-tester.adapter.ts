import type { ISeerrConnectionTester } from '@/server/application/services/seerr-connection-tester.service.interface';

export class HttpSeerrConnectionTester implements ISeerrConnectionTester {
  async testConnection(
    url: string,
    apiKey: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      // /api/v1/status is public, so it cannot tell a valid API key from a bogus one.
      // /api/v1/auth/me requires authentication and returns the key's owner.
      const response = await fetch(`${url}/api/v1/auth/me`, {
        headers: {
          'X-Api-Key': apiKey,
        },
      });

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          message: 'Connected to Seerr, but the API key was rejected.',
        };
      }

      if (!response.ok) {
        return {
          success: false,
          message: `Failed to connect: ${response.statusText}`,
        };
      }

      return {
        success: true,
        message: 'Connection successful',
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
