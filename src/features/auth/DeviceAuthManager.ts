import * as SecureStore from 'expo-secure-store';
import 'react-native-get-random-values';
import uuid from 'react-native-uuid';
import { useConnectionStore } from '../../stores/connectionStore';
import { MobileLogger } from '../../shared/utils/logger';
import * as Application from 'expo-application';
import * as Device from 'expo-device';

const logger = new MobileLogger('DeviceAuthManager');

const DEVICE_SERIAL_KEY = 'jabbelpin.device.serial';
const AUTH_TOKEN_KEY = 'jabbelpin.auth.token';

interface RegisterResponse {
  deviceId: string;
  token: string;
  expiresAt: string;
}

export class DeviceAuthManager {
  private static isRefreshing = false;
  private static refreshPromise: Promise<string> | null = null;

  static async initialize(): Promise<void> {
    try {
      const existingToken = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
      if (existingToken && !this.isTokenExpired(existingToken)) {
        logger.info('Found existing valid auth token');
        useConnectionStore.getState().setAuthToken(existingToken);
        
        try {
          const parts = existingToken.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]!));
            if (payload.deviceId) {
              useConnectionStore.getState().setHardwareId(payload.deviceId);
            }
          }
        } catch (err) {
          logger.warn('Failed to extract hardwareId from existing token payload');
        }
      } else {
        if (existingToken) {
          logger.warn('Stored auth token is expired, re-registering device');
          await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
        } else {
          logger.info('No existing auth token, registering device');
        }
        await this.registerDevice();
      }
    } catch (error) {
      logger.error({ error }, 'Failed to initialize DeviceAuthManager');
    }
  }

  /**
   * Decode the JWT payload and check if it's expired or expiring within
   * the next 60 seconds (clock-skew buffer).
   */
  static isTokenExpired(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      const payload = JSON.parse(atob(parts[1]!));
      if (!payload.exp) return false; // no expiry claim — treat as valid
      const expiresAtMs = payload.exp * 1000;
      const bufferMs = 60 * 1000; // 60-second early refresh buffer
      return Date.now() >= expiresAtMs - bufferMs;
    } catch {
      return true; // malformed token — treat as expired
    }
  }

  static async registerDevice(): Promise<string> {
    try {
      let serial = await SecureStore.getItemAsync(DEVICE_SERIAL_KEY);
      if (!serial) {
        serial = uuid.v4() as string;
        await SecureStore.setItemAsync(DEVICE_SERIAL_KEY, serial);
        logger.info({ serial }, 'Generated new device serial');
      }

      const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.jabbelpin.com/v1';
      const url = `${baseUrl}/devices/register`;

      logger.info('Registering device with backend...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': '69420',
        },
        signal: controller.signal,
        body: JSON.stringify({
          deviceSerial: serial,
          firmwareVersion: Application.nativeApplicationVersion || '1.0.0',
          model: Device.modelName || 'MobileApp',
          userId: process.env.EXPO_PUBLIC_USER_ID,
        }),
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Registration failed with status ${response.status}`);
      }

      const data: RegisterResponse = await response.json();
      
      await SecureStore.setItemAsync(AUTH_TOKEN_KEY, data.token);
      useConnectionStore.getState().setAuthToken(data.token);
      useConnectionStore.getState().setHardwareId(data.deviceId);
      
      logger.info({ deviceId: data.deviceId }, 'Successfully registered device and stored token');
      
      return data.token;
    } catch (error) {
      logger.error({ error }, 'Error registering device');
      throw error;
    }
  }

  static async refreshToken(): Promise<string> {
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = this.registerDevice().finally(() => {
      this.isRefreshing = false;
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }
}
