/**
 * BLE Constants — all UUIDs, timeouts, and protocol constants.
 * NO magic numbers anywhere in the codebase — import from here.
 */

/** JabbelPin Audio GATT Service UUID */
export const BLE_SERVICE_UUID = '0000AABB-0000-1000-8000-00805F9B34FB';

/** AUDIO_TX characteristic — Watch → Phone audio packet stream (NOTIFY) */
export const BLE_AUDIO_CHARACTERISTIC_UUID = '0000AABC-0000-1000-8000-00805F9B34FB';

/** HEARTBEAT_TX characteristic — Watch → Phone liveness heartbeat (NOTIFY) */
export const BLE_HEARTBEAT_CHARACTERISTIC_UUID = '0000AABD-0000-1000-8000-00805F9B34FB';

/** CONTROL_RX characteristic — Phone → Watch commands (WRITE) */
export const BLE_CONTROL_CHARACTERISTIC_UUID = '0000AABE-0000-1000-8000-00805F9B34FB';

/** Device Information Service UUID */
export const BLE_DEVICE_INFO_SERVICE_UUID = '0000180A-0000-1000-8000-00805F9B34FB';

/** Serial Number String Characteristic UUID */
export const BLE_SERIAL_NUMBER_CHAR_UUID = '00002A25-0000-1000-8000-00805F9B34FB';

/** How long to scan before giving up (30 seconds) */
export const BLE_SCAN_TIMEOUT_MS = 30_000;

/** Desired ATT MTU size in bytes (Galaxy Watch 4+ supports up to 517) */
export const BLE_MTU_SIZE = 512;

/** Maximum reconnect backoff interval */
export const MAX_RECONNECT_INTERVAL_MS = 30_000;

/** Watch heartbeat interval — 60 seconds */
export const HEARTBEAT_INTERVAL_MS = 60_000;

/** WebSocket ping interval */
export const WEBSOCKET_PING_INTERVAL_MS = 30_000;

/** BLE packet magic bytes — "JP" in ASCII */
export const PACKET_MAGIC = 0x4a50;

/** BLE protocol version */
export const PACKET_VERSION = 0x01;

/** Fixed header size in bytes (2+1+1+1+4+8+16+16+2+4 = 55) */
export const PACKET_HEADER_SIZE = 55;

/** Relay poll interval in milliseconds */
export const RELAY_POLL_INTERVAL_MS = 250;

/** Maximum packets per relay batch */
export const RELAY_BATCH_SIZE = 500;

/** OTA chunk size in bytes (must fit within MTU - header overhead) */
export const OTA_CHUNK_SIZE = 450;

/** OTA command codes for CONTROL_RX characteristic */
export const OTA_CMD_START = 0x10;
export const OTA_CMD_CHUNK = 0x11;
export const OTA_CMD_END = 0x12;

/** WebSocket reconnect delays in milliseconds (capped exponential backoff) */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30_000] as const;

/** WebSocket ACK timeout in milliseconds */
export const WS_ACK_TIMEOUT_MS = 5000;

/** WebSocket namespace */
export const WS_NAMESPACE = '/device';

/** SQLite database name */
export const DB_NAME = 'jabbelpin.db';

/** Number of packets to fetch per getPendingPackets call */
export const PENDING_PACKETS_BATCH_SIZE = 500;
