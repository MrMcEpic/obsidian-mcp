import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RestApiService } from './rest-api.js';

// We'll mock axios
vi.mock('axios');

describe('RestApiService', () => {
  it('should construct with config', () => {
    const service = new RestApiService({
      baseUrl: 'http://127.0.0.1:27123',
      apiKey: 'test-key',
      timeout: 5000,
    });
    expect(service).toBeDefined();
  });

  it('should return isAvailable false when connection fails', async () => {
    const service = new RestApiService({
      baseUrl: 'http://127.0.0.1:99999',
      apiKey: 'test-key',
      timeout: 1000,
    });
    const available = await service.isAvailable();
    expect(available).toBe(false);
  });
});
