import { useConnectionStore } from '../../stores/connectionStore';
import { DeviceAuthManager } from '../../features/auth/DeviceAuthManager';
import { MobileLogger } from './logger';

const logger = new MobileLogger('ApiClient');

export async function authenticatedFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  console.log('[ApiClient] authenticatedFetch started for:', typeof input === 'string' ? input : 'Request object');
  let token = useConnectionStore.getState().authToken;

  if (!token) {
    logger.info('No token found, requesting new token before fetch');
    console.log('[ApiClient] No token found, calling DeviceAuthManager.refreshToken()');
    try {
      token = await DeviceAuthManager.refreshToken();
      console.log('[ApiClient] Token refreshed successfully');
    } catch (e) {
      console.error('[ApiClient] Failed to refresh token:', e);
      throw e;
    }
  }

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('ngrok-skip-browser-warning', '69420');

  const config: RequestInit = {
    ...init,
    headers,
  };

  console.log('[ApiClient] Executing fetch...');
  let response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    response = await fetch(input, { ...config, signal: controller.signal });
    clearTimeout(timeoutId);
    console.log('[ApiClient] Fetch completed, status:', response.status);
  } catch (e) {
    console.error('[ApiClient] Fetch threw an error:', e);
    throw e;
  }

  if (response.status === 401) {
    logger.warn('Token expired (401), refreshing token and retrying request');
    console.log('[ApiClient] Token expired (401), refreshing token and retrying request');
    let newToken;
    try {
      newToken = await DeviceAuthManager.refreshToken();
    } catch (e) {
      console.error('[ApiClient] Failed to refresh token on 401 retry:', e);
      throw e;
    }
    
    // Update header with new token
    headers.set('Authorization', `Bearer ${newToken}`);
    const retryConfig: RequestInit = {
      ...init,
      headers,
    };
    
    console.log('[ApiClient] Retrying fetch...');
    try {
      response = await fetch(input, retryConfig);
      console.log('[ApiClient] Retry fetch completed, status:', response.status);
    } catch (e) {
      console.error('[ApiClient] Retry fetch threw an error:', e);
      throw e;
    }
  }

  return response;
}
