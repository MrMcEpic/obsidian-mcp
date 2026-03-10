import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type { RestApiConfig, RestApiNoteResponse } from '../types.js';

export class RestApiService {
  private client: AxiosInstance;
  private config: RestApiConfig;

  constructor(config: RestApiConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.get('/');
      return true;
    } catch {
      return false;
    }
  }

  async readNote(path: string): Promise<RestApiNoteResponse> {
    const encodedPath = encodeURIComponent(path);
    const response = await this.client.get(`/vault/${encodedPath}`, {
      headers: { 'Accept': 'application/vnd.olrapi.note+json' },
    });
    return response.data;
  }

  async writeNote(path: string, content: string): Promise<void> {
    const encodedPath = encodeURIComponent(path);
    await this.client.put(`/vault/${encodedPath}`, content, {
      headers: { 'Content-Type': 'text/markdown' },
    });
  }

  async appendNote(path: string, content: string): Promise<void> {
    const encodedPath = encodeURIComponent(path);
    await this.client.post(`/vault/${encodedPath}`, content, {
      headers: { 'Content-Type': 'text/markdown' },
    });
  }

  async deleteNote(path: string): Promise<void> {
    const encodedPath = encodeURIComponent(path);
    await this.client.delete(`/vault/${encodedPath}`);
  }

  async listDirectory(path: string = '/'): Promise<{ files: string[]; }> {
    const encodedPath = encodeURIComponent(path);
    const response = await this.client.get(`/vault/${encodedPath}`, {
      headers: { 'Accept': 'application/json' },
    });
    return response.data;
  }

  async getActiveNote(): Promise<RestApiNoteResponse> {
    const response = await this.client.get('/active/', {
      headers: { 'Accept': 'application/vnd.olrapi.note+json' },
    });
    return response.data;
  }

  async getPeriodicNote(period: string): Promise<RestApiNoteResponse> {
    const response = await this.client.get(`/periodic/${period}/`, {
      headers: { 'Accept': 'application/vnd.olrapi.note+json' },
    });
    return response.data;
  }

  async search(query: string): Promise<Array<{ filename: string; score: number; matches: Array<{ match: { start: number; end: number }; context: string }> }>> {
    const response = await this.client.post('/search/simple/', query, {
      headers: { 'Content-Type': 'text/plain' },
    });
    return response.data;
  }
}
