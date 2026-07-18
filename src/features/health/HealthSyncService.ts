/**
 * HealthSyncService
 *
 * Periodically reads health metrics from Google Health Connect and pushes them
 * to the backend via the existing authenticated WebSocket connection.
 *
 * Data flow:
 *   Samsung Watch --(BLE, auto)→ Samsung Health app → Health Connect → THIS SERVICE → Backend
 *
 * Sync interval: 15 minutes
 *   - Heart Rate: Samsung samples every 1s, HC batches every ~10 min
 *   - SpO2:       Samsung samples every 30s, HC batches every ~15 min
 *   - Steps:      Samsung continuous, HC batches every ~10 min
 *   - Sleep:      Written once after wake-up (we look back 12h)
 *   Reading more often than 15 min just returns duplicate data.
 */

import { initialize, requestPermission, getGrantedPermissions, readRecords } from 'react-native-health-connect';
import { MobileLogger } from '@/shared/utils/logger';
import { Platform } from 'react-native';
import { useHealthSyncStore } from '@/stores/healthSyncStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { authenticatedFetch } from '@/shared/utils/apiClient';

const logger = new MobileLogger('HealthSyncService');

/** How often we pull from Health Connect and push to the server (ms) */
export const HEALTH_SYNC_INTERVAL_MS = 1 * 60 * 1000; // 1 minute

// The backend API payload format
export interface HealthMetricPayload {
  metricType: string;
  value: number;
  unit: string;
  startedAt: string;
  endedAt: string;
}

export class HealthSyncService {
  private initialized = false;
  private hasPermissions = false;
  private lastSyncAt: Date | null = null; // tracks the end of the last sync window

  /**
   * Initialize Health Connect and check existing permissions.
   * Call once on app startup (safe to call in background).
   */
  async setup(): Promise<boolean> {
    try {
      const providerPackageName = Platform.Version >= 34
        ? 'com.android.healthconnect.controller'
        : 'com.google.android.apps.healthdata';
      
      this.initialized = await initialize(providerPackageName);
      if (!this.initialized) {
        logger.warn('Health Connect not available on this device/OS version');
        return false;
      }

      const granted = await getGrantedPermissions();
      logger.info({ granted }, 'getGrantedPermissions returned');
      
      // We need read permissions for HeartRate, Steps, SleepSession, OxygenSaturation
      const hasAll = granted.some(p => p.recordType === 'HeartRate') &&
                     granted.some(p => p.recordType === 'Steps') &&
                     granted.some(p => p.recordType === 'SleepSession') &&
                     granted.some(p => p.recordType === 'OxygenSaturation');

      this.hasPermissions = hasAll;
      logger.info({ granted: granted.length, hasAll }, 'Health Connect permissions checked');
      return this.hasPermissions;
    } catch (err) {
      logger.error({ err }, 'Health Connect setup failed');
      return false;
    }
  }

  /**
   * Explicitly request permissions from the user.
   * MUST ONLY BE CALLED FROM A FOREGROUND UI COMPONENT!
   */
  async requestPermissions(): Promise<boolean> {
    try {
      const granted = await requestPermission([
        { accessType: 'read', recordType: 'HeartRate' },
        { accessType: 'read', recordType: 'Steps' },
        { accessType: 'read', recordType: 'SleepSession' },
        { accessType: 'read', recordType: 'OxygenSaturation' },
      ]);
      this.hasPermissions = granted.length > 0;
      return this.hasPermissions;
    } catch (err) {
      logger.error({ err }, 'Failed to request permissions');
      return false;
    }
  }

  /**
   * Reset the last sync time to force an immediate sync on the next tick
   */
  forceSyncNextTick(): void {
    this.lastSyncAt = null;
  }

  // ─── Periodic Tick ────────────────────────────────────────────────────────

  /**
   * Call this every minute from the App.tsx background loop.
   * It tracks elapsed time internally and only performs a real sync
   * every HEALTH_SYNC_INTERVAL_MS.
   */
  async tick(): Promise<void> {
    const now = new Date();

    // Skip if not ready
    if (!this.initialized || !this.hasPermissions) return;

    // Skip if we synced less than interval ago
    if (
      this.lastSyncAt &&
      now.getTime() - this.lastSyncAt.getTime() < HEALTH_SYNC_INTERVAL_MS
    ) {
      return;
    }

    const windowStart = this.lastSyncAt
      ? this.lastSyncAt
      : new Date(now.getTime() - HEALTH_SYNC_INTERVAL_MS);

    logger.info(
      { from: windowStart.toISOString(), to: now.toISOString() },
      'Health sync tick — reading from Health Connect',
    );

    const metrics = await this.readMetricsForWindow(windowStart, now);

    if (metrics.length > 0) {
      try {
        const deviceId = useConnectionStore.getState().hardwareId;
        const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.jabbelpin.com/v1';
        
        const response = await authenticatedFetch(`${baseUrl}/health/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, metrics }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }

        const result = await response.json();
        logger.info({ saved: result.saved }, 'Health metrics pushed to server');
        useHealthSyncStore.getState().addLog({
          timestamp: new Date().toISOString(),
          recordCount: metrics.length,
          status: 'success',
          message: `Successfully pushed ${metrics.length} records.`,
        });
      } catch (err: any) {
        // Don't update lastSyncAt so we retry on next tick
        logger.error({ err }, 'Failed to send health batch — will retry next tick');
        useHealthSyncStore.getState().addLog({
          timestamp: new Date().toISOString(),
          recordCount: metrics.length,
          status: 'error',
          message: `Failed to push metrics: ${err.message}`,
        });
        return;
      }
    } else {
      logger.info('No new health data in this window');
      useHealthSyncStore.getState().addLog({
        timestamp: new Date().toISOString(),
        recordCount: 0,
        status: 'success',
        message: 'No new health data available.',
      });
    }

    this.lastSyncAt = now; // advance the window
  }

  // ─── Core Reader ──────────────────────────────────────────────────────────

  /** Read all metric types from Health Connect for the given time window. */
  async readMetricsForWindow(
    startTime: Date,
    endTime: Date,
  ): Promise<HealthMetricPayload[]> {
    if (!this.initialized || !this.hasPermissions) return [];

    const metrics: HealthMetricPayload[] = [];
    const timeRangeFilter = {
      operator: 'between' as const,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };

    // Heart Rate (1 reading per second → many samples per batch)
    try {
      const result = await readRecords('HeartRate', { timeRangeFilter });
      for (const record of result.records) {
        for (const sample of record.samples) {
          metrics.push({
            metricType: 'heart_rate',
            value: { bpm: sample.beatsPerMinute },
            recordedAt: sample.time,
          });
        }
      }
      logger.debug({ count: metrics.length }, 'Heart rate samples read');
    } catch (err) {
      logger.warn({ err }, 'Failed to read HeartRate');
    }

    // Steps (aggregated per interval, not per step)
    try {
      const result = await readRecords('Steps', { timeRangeFilter });
      for (const record of result.records) {
        metrics.push({
          metricType: 'steps',
          value: { count: record.count },
          recordedAt: record.startTime,
        });
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read Steps');
    }

    // SpO2 (spot check every ~30s)
    try {
      const result = await readRecords('OxygenSaturation', { timeRangeFilter });
      for (const record of result.records) {
        metrics.push({
          metricType: 'spo2',
          value: { percentage: record.percentage },
          recordedAt: record.time,
        });
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read OxygenSaturation');
    }

    // Sleep — look back 12 hours to capture last night's data
    // (sleep ends in the morning, so a 15-min forward window would miss it)
    try {
      const sleepWindowStart = new Date(startTime.getTime() - 12 * 60 * 60 * 1000);
      const sleepResult = await readRecords('SleepSession', {
        timeRangeFilter: {
          operator: 'between',
          startTime: sleepWindowStart.toISOString(),
          endTime: endTime.toISOString(),
        },
      });
      for (const record of sleepResult.records) {
        if (record.stages) {
          for (const stage of record.stages) {
            const stageDuration = Math.round(
              (new Date(stage.endTime).getTime() - new Date(stage.startTime).getTime()) / 1000,
            );
            metrics.push({
              metricType: 'sleep',
              value: { stage: stage.stage, durationSeconds: stageDuration },
              recordedAt: stage.startTime,
            });
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read SleepSession');
    }

    return metrics;
  }
}
