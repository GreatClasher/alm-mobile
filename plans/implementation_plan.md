# JabbelPin Mobile App — Implementation Plan

**Service**: `apps/mobile/` — React Native 0.74+ · Expo (Metro bundler) · TypeScript 5.4+ · Android target

> Read alongside: `docs/08-mobile-guidelines.md`, `docs/10-ble-protocol.md`, `docs/11-api-contracts.md`, `docs/05-testing-strategy.md`, `prompts/mobile.prompt.md`

---

## Key Architecture Note: Expo + Metro

The mobile app uses **Expo with Metro bundler** (not bare React Native CLI). This provides:
- Metro bundler (fast refresh, module resolution)
- Expo Modules API for native module integration
- `expo-sqlite` instead of `react-native-quick-sqlite` (Expo-compatible SQLite)
- `expo-network` for connectivity monitoring
- `react-native-ble-plx` (works with Expo bare workflow)
- `socket.io-client` (pure JS — works out of the box)

> **Important**: Use **Expo bare workflow** (`npx create-expo-app --template bare-minimum`). This gives Metro bundler + native module access (BLE requires native code). Do NOT use managed Expo workflow — BLE and background tasks need `expo-modules-core` + native build.

---

## Dependency Order

```
Phase 0 (Expo Scaffold + Metro Config)
  └─→ Phase 1 (Shared Types + Packet Deserializer)
         └─→ Phase 2 (SQLite Queue)
                └─→ Phase 3 (BLE Connection + Packet Service)
                       └─→ Phase 4 (WebSocket Client)
                              └─→ Phase 5 (Packet Relay Service)
                                     └─→ Phase 6 (Heartbeat Forwarder)
                                            └─→ Phase 7 (Network Monitor + Recovery)
                                                   └─→ Phase 8 (OTA Coordinator)
                                                          └─→ Phase 9 (UI Status Screen)
```

---

## Phase 0 — Expo Bare Scaffold + Metro Config

**Goal**: Working Expo bare app with Metro, TypeScript strict mode, ESLint, Jest, and path aliases configured.

### Bootstrap Command

```bash
npx create-expo-app@latest apps/mobile --template bare-minimum
cd apps/mobile
npx expo install expo-sqlite expo-network expo-file-system expo-crypto
npm install react-native-ble-plx socket.io-client zustand @tanstack/react-query
npm install -D jest @testing-library/react-native ts-jest @types/jest eslint prettier
```

### Files to Create / Modify

#### [MODIFY] `apps/mobile/tsconfig.json`
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "paths": {
      "@/*": ["./src/*"],
      "@shared/*": ["./src/shared/*"]
    }
  }
}
```

#### [MODIFY] `apps/mobile/metro.config.js`
Enable path aliases using `metro-config` resolver:
```javascript
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.resolver.extraNodeModules = {
  '@': path.resolve(__dirname, 'src'),
};
module.exports = config;
```

#### [NEW] `apps/mobile/babel.config.js`
```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module-resolver', {
        root: ['./src'],
        alias: { '@': './src' },
      }],
    ],
  };
};
```
Add `babel-plugin-module-resolver` as dev dependency.

#### [NEW] `apps/mobile/jest.config.ts`
```typescript
export default {
  preset: 'jest-expo',
  testMatch: ['**/*.spec.ts', '**/*.spec.tsx'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.types.ts',
    '!src/navigation/**',
    '!src/App.tsx',
  ],
  coverageThresholds: {
    global: { statements: 80, branches: 75, functions: 80, lines: 80 },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
```

#### [NEW] `apps/mobile/.eslintrc.json`
Same rules as backend: `no-any`, `explicit-function-return-type`, `no-console`.

#### [NEW] `apps/mobile/__mocks__/react-native-ble-plx.ts`
Full manual mock of `BleManager`, `Device`, `Characteristic` for Jest unit tests.

#### [NEW] `apps/mobile/__mocks__/expo-sqlite.ts`
Mock of `expo-sqlite` `SQLiteDatabase` for unit tests.

#### [NEW] `apps/mobile/.env.example`
```
EXPO_PUBLIC_WS_URL=wss://api.jabbelpin.com
EXPO_PUBLIC_API_BASE_URL=https://api.jabbelpin.com/v1
```

### Acceptance Criteria — Phase 0
- [ ] `npx expo start` launches Metro bundler without errors
- [ ] `npm test` runs Jest (zero tests, but runner works)
- [ ] TypeScript: `npx tsc --noEmit` — zero errors
- [ ] ESLint: zero errors
- [ ] Path alias `@/shared/types/AudioPacket` resolves correctly

---

## Phase 1 — Shared Types & Packet Deserializer

**Goal**: Core data types and the binary BLE packet deserializer tested in complete isolation.

### Files to Create

#### [NEW] `src/shared/types/AudioPacket.ts`
```typescript
export const PacketPayloadType = {
  AUDIO: 'AUDIO',
  HEARTBEAT: 'HEARTBEAT',
  CONTROL: 'CONTROL',
  DIAGNOSTIC: 'DIAGNOSTIC',
} as const;
export type PacketPayloadType = (typeof PacketPayloadType)[keyof typeof PacketPayloadType];

export interface AudioPacket {
  readonly deviceId: string;
  readonly sessionId: string;
  readonly sequenceNo: number;
  readonly timestamp: number;
  readonly payloadType: PacketPayloadType;
  readonly payload: Uint8Array;
  readonly checksum: string;
}

export interface StoredPacket extends AudioPacket {
  readonly localId: number;
  readonly status: PacketStatus;
  readonly receivedAt: number;
  readonly deliveredAt: number | null;
}
```

#### [NEW] `src/shared/types/PacketStatus.ts`
```typescript
export const PacketStatus = {
  PENDING: 'PENDING',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
} as const;
export type PacketStatus = (typeof PacketStatus)[keyof typeof PacketStatus];
```

#### [NEW] `src/shared/constants/ble.constants.ts`
```typescript
export const BLE_SERVICE_UUID = '0000AABB-0000-1000-8000-00805F9B34FB';
export const BLE_AUDIO_CHARACTERISTIC_UUID = '0000AABC-0000-1000-8000-00805F9B34FB';
export const BLE_HEARTBEAT_CHARACTERISTIC_UUID = '0000AABD-0000-1000-8000-00805F9B34FB';
export const BLE_CONTROL_CHARACTERISTIC_UUID = '0000AABE-0000-1000-8000-00805F9B34FB';
export const BLE_SCAN_TIMEOUT_MS = 30_000;
export const BLE_MTU_SIZE = 512;
export const MAX_RECONNECT_INTERVAL_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const WEBSOCKET_PING_INTERVAL_MS = 30_000;
export const PACKET_MAGIC = 0x4a50;
export const PACKET_VERSION = 0x01;
export const PACKET_HEADER_SIZE = 55;
```

#### [NEW] `src/shared/utils/checksum.ts`
CRC32 implementation. Must match the Kotlin `CRC32.compute()` and backend `checksum.util.ts`.

#### [NEW] `src/shared/utils/logger.ts`
`MobileLogger` class — wraps `console` in dev, no-ops in test, structured JSON in production.
No direct `console.log` anywhere else in the codebase — always use this.

#### [NEW] `src/shared/errors/PacketValidationError.ts`
```typescript
export class PacketValidationError extends Error {
  constructor(message: string, public readonly context: Record<string, unknown>) {
    super(message);
    this.name = 'PacketValidationError';
  }
}
```

#### [NEW] `src/shared/errors/BleConnectionError.ts`
#### [NEW] `src/shared/errors/BleCharacteristicError.ts`
#### [NEW] `src/shared/errors/SqliteStorageError.ts`
#### [NEW] `src/shared/errors/WebSocketSendError.ts`

#### [NEW] `src/features/bluetooth/utils/packet-deserializer.ts`
Full implementation per `docs/10-ble-protocol.md`:
- Validate MAGIC (`0x4A50`)
- Validate VERSION (`0x01`)
- Decode PAYLOAD_TYPE (0x01–0x04)
- Parse SEQUENCE_NO (uint32 BE, bytes 5–8)
- Parse TIMESTAMP (int64 BE, bytes 9–16)
- Parse DEVICE_ID UUID (bytes 17–32)
- Parse SESSION_ID UUID (bytes 33–48)
- Parse PAYLOAD_LEN (uint16 BE, bytes 49–50)
- Parse CHECKSUM (uint32 BE, bytes 51–54)
- Slice PAYLOAD (bytes 55 .. 55+PAYLOAD_LEN)
- Validate PAYLOAD_LEN matches actual byte count

#### [NEW] `src/features/bluetooth/utils/__tests__/packet-deserializer.spec.ts`

### TDD — Phase 1 Test Scenarios

| Test | File | Scenario |
|---|---|---|
| Valid AUDIO packet | `packet-deserializer.spec.ts` | All fields parsed correctly |
| Valid HEARTBEAT packet | `packet-deserializer.spec.ts` | Empty payload, payloadType='HEARTBEAT' |
| Wrong MAGIC bytes | `packet-deserializer.spec.ts` | Throws `PacketValidationError('Invalid magic bytes')` |
| Wrong VERSION | `packet-deserializer.spec.ts` | Throws `PacketValidationError('Unsupported protocol version')` |
| Unknown PAYLOAD_TYPE | `packet-deserializer.spec.ts` | Throws `PacketValidationError('Unknown payload type')` |
| PAYLOAD_LEN mismatch | `packet-deserializer.spec.ts` | Throws `PacketValidationError('Payload length mismatch')` |
| Packet too short (< 55 bytes) | `packet-deserializer.spec.ts` | Throws `PacketValidationError('Packet too short')` |
| UUID formatting | `packet-deserializer.spec.ts` | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` format |
| CRC32 known value | `checksum.spec.ts` | `crc32([0x01, 0x02, 0x03]) === known_value` |
| CRC32 empty payload | `checksum.spec.ts` | CRC32 of empty = known constant |
| CRC32 matches Kotlin output | `checksum.spec.ts` | Cross-platform test vector |

### Acceptance Criteria — Phase 1
- [ ] Deserializer parses a real captured BLE packet binary correctly
- [ ] All 11 unit tests pass
- [ ] CRC32 output matches known test vectors
- [ ] Zero TypeScript errors on shared types
- [ ] 100% coverage on `packet-deserializer.ts` and `checksum.ts`

---

## Phase 2 — SQLite Packet Queue

**Goal**: Durable local packet store with enqueue / dequeue / markDelivered, using `expo-sqlite`.

### Files to Create

#### [NEW] `src/features/storage/migrations/001_create_packet_queue.sql`
```sql
CREATE TABLE IF NOT EXISTS packet_queue (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  payload_type TEXT NOT NULL,
  payload TEXT NOT NULL,         -- base64-encoded Uint8Array
  checksum TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  received_at INTEGER NOT NULL,
  delivered_at INTEGER,
  UNIQUE(session_id, sequence_no)
);
CREATE INDEX IF NOT EXISTS idx_packet_queue_status ON packet_queue(status);
CREATE INDEX IF NOT EXISTS idx_packet_queue_session_seq ON packet_queue(session_id, sequence_no);
```

#### [NEW] `src/features/storage/SqlitePacketQueue.ts`
Uses `expo-sqlite` (`openDatabaseAsync`). Methods:
- `initialize(): Promise<void>` — open DB, run migration SQL
- `enqueue(packet: AudioPacket): Promise<number>` — `INSERT OR IGNORE`, returns `localId`
- `getPendingPackets(limit = 50): Promise<ReadonlyArray<StoredPacket>>` — ORDER BY `session_id, sequence_no`
- `markDelivered(localId: number): Promise<void>`
- `markFailed(localId: number): Promise<void>`
- `getPendingCount(): Promise<number>`
- `pruneDelivered(olderThanMs: number): Promise<number>` — delete delivered packets older than threshold

#### [NEW] `src/features/storage/__tests__/SqlitePacketQueue.spec.ts`

### TDD — Phase 2 Test Scenarios

| Test | Scenario |
|---|---|
| `enqueue` happy path | Packet inserted, returns positive `localId` |
| `enqueue` duplicate (session+seq) | Silently ignored (`INSERT OR IGNORE`), no throw |
| `getPendingPackets` — empty queue | Returns `[]` |
| `getPendingPackets` — order | Returns packets ordered by `session_id, sequence_no` |
| `getPendingPackets` — limit respected | Returns at most `limit` packets |
| `markDelivered` | Status changed to `DELIVERED`, `delivered_at` set |
| `markFailed` | Status changed to `FAILED` |
| `getPendingCount` — mixed statuses | Only counts `PENDING` rows |
| `pruneDelivered` — old records | Deletes DELIVERED rows older than threshold |
| `pruneDelivered` — recent records | Does not delete recent DELIVERED rows |
| DB initialization idempotent | `initialize()` called twice — no error |

### Acceptance Criteria — Phase 2
- [ ] All 11 unit tests pass (mocked `expo-sqlite`)
- [ ] `UNIQUE(session_id, sequence_no)` prevents duplicates
- [ ] `getPendingPackets(50)` never returns more than 50 rows
- [ ] Delivered packets are cleanly prunable
- [ ] ≥ 80% coverage on `SqlitePacketQueue.ts`

---

## Phase 3 — BLE Connection & Packet Service

**Goal**: Connect to Samsung Galaxy Watch BLE GATT, subscribe to `AUDIO_TX`, decode and validate packets.

### Files to Create

#### [NEW] `src/features/bluetooth/BleManager.ts`
Singleton wrapper around `react-native-ble-plx` `BleManager`. One instance per app lifetime.

#### [NEW] `src/features/bluetooth/services/BleConnectionService.ts`
- `connect(callbacks: BleConnectionCallbacks): Promise<void>` — scan for `BLE_SERVICE_UUID`, connect, request MTU 512, discover services
- `disconnect(): void`
- Reconnect logic: on disconnect, wait with exponential backoff (1s→2s→4s→8s→30s), retry `connect()`
- Emits: `onConnected(deviceName)`, `onDisconnected()`, `onError(error)`

#### [NEW] `src/features/bluetooth/services/BlePacketService.ts`
- `startMonitoring(callbacks: BlePacketServiceCallbacks): void` — subscribe to `AUDIO_TX` characteristic NOTIFY
- `stopMonitoring(): void` — unsubscribe
- On each notification: base64-decode → `deserializePacket()` → `verifyChecksum()` → call `onPacketReceived`
- On error: call `onError(new BleCharacteristicError(...))`

#### [NEW] `src/features/bluetooth/types/BleConnectionState.ts`
```typescript
export const BleConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  SCANNING: 'SCANNING',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
} as const;
```

#### [NEW] `src/features/bluetooth/hooks/useBluetoothConnection.ts`
React hook: manages `BleConnectionService` lifecycle, exposes `{ state, deviceName, error }`.
- Starts `BleConnectionService` on mount
- Calls `disconnect()` in cleanup
- Uses `useRef` to hold service instance (not in state)

#### [NEW] `src/features/bluetooth/hooks/useBlePacketStream.ts`
React hook: manages `BlePacketService` lifecycle. Calls `onPacketReceived` callback.

#### [NEW] `src/features/bluetooth/services/__tests__/BlePacketService.spec.ts`
#### [NEW] `src/features/bluetooth/services/__tests__/BleConnectionService.spec.ts`

### TDD — Phase 3 Test Scenarios

| Test | File | Scenario |
|---|---|---|
| `startMonitoring` — valid packet | `BlePacketService.spec.ts` | Callback `onPacketReceived` called with correct `AudioPacket` |
| `startMonitoring` — checksum mismatch | `BlePacketService.spec.ts` | `onError` called with `PacketValidationError` |
| `startMonitoring` — malformed bytes | `BlePacketService.spec.ts` | `onError` called with `PacketValidationError` |
| `startMonitoring` — BLE error event | `BlePacketService.spec.ts` | `onError` called with `BleCharacteristicError` |
| `startMonitoring` — null characteristic | `BlePacketService.spec.ts` | Silently skipped (no crash) |
| `stopMonitoring` — cleans up | `BlePacketService.spec.ts` | Subscription `remove()` called |
| `startMonitoring` — already monitoring | `BlePacketService.spec.ts` | Logs warn, no duplicate subscription |
| `connect` — success flow | `BleConnectionService.spec.ts` | `onConnected` called with device name |
| `connect` — BLE scan timeout | `BleConnectionService.spec.ts` | `onError` called after `BLE_SCAN_TIMEOUT_MS` |
| `disconnect` — triggers reconnect | `BleConnectionService.spec.ts` | `onDisconnected` called, reconnect scheduled |
| Exponential backoff | `BleConnectionService.spec.ts` | Jest fake timers: delays increase correctly |

### Acceptance Criteria — Phase 3
- [ ] All 11 unit tests pass (mocked `react-native-ble-plx`)
- [ ] `startMonitoring` never called twice without `stopMonitoring` first
- [ ] CRC32 verified on EVERY received packet before calling `onPacketReceived`
- [ ] Checksum failure calls `onError` — packet is NOT forwarded
- [ ] BLE cleanup always runs in `useEffect` return
- [ ] No memory leaks: subscription removed on `stopMonitoring`

---

## Phase 4 — WebSocket Client

**Goal**: Persistent connection to backend. Sends packets with ACK. Exponential reconnect.

### Files to Create

#### [NEW] `src/features/streaming/WebSocketClient.ts`
```typescript
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30_000];

export class WebSocketClient {
  private socket: Socket | null = null;
  private reconnectAttempt = 0;

  connect(): void { /* ... */ }
  async sendPacket(packet: StoredPacket): Promise<{ status: string; packetId?: string }> { /* ... */ }
  disconnect(): void { /* ... */ }
  get isConnected(): boolean { return this.socket?.connected ?? false; }

  // Internal handlers:
  private handleConnect(): void   // log, reset reconnectAttempt
  private handleDisconnect(): void // log, scheduleReconnect
  private handleConnectError(): void // log, scheduleReconnect
  private scheduleReconnect(): void // setTimeout with capped exponential delay
}
```

Key behaviors:
- `auth: { token: config.authToken }` on handshake
- `transports: ['websocket']` — no polling
- `reconnection: false` — we manage reconnection manually
- `sendPacket` uses `socket.timeout(5000).emit('audio:packet', ..., callback)`
- On callback error: throw `WebSocketSendError`
- On disconnect: log and schedule reconnect

#### [NEW] `src/features/streaming/hooks/useWebSocketConnection.ts`
Exposes `{ isConnected }`. Manages `WebSocketClient` lifecycle.

#### [NEW] `src/features/streaming/__tests__/WebSocketClient.spec.ts`

### TDD — Phase 4 Test Scenarios

| Test | Scenario |
|---|---|
| `connect` — success | `socket.on('connect')` fires; `isConnected = true`; `reconnectAttempt = 0` |
| `connect` — auth error | Connection refused; `handleConnectError` fires; reconnect scheduled |
| `sendPacket` — ACK `accepted` | Returns `{ status: 'accepted', packetId }` |
| `sendPacket` — ACK `rejected` | Throws `WebSocketSendError` |
| `sendPacket` — timeout (5s) | Throws `WebSocketSendError('timeout')` |
| `sendPacket` — not connected | Throws `WebSocketSendError('not connected')` |
| `handleDisconnect` — schedules reconnect | `setTimeout` called with correct delay |
| Backoff: attempt 1 | Delay = 1000ms |
| Backoff: attempt 5 | Delay = 16000ms |
| Backoff: attempt 10 | Delay capped at 30000ms |
| `disconnect` | `socket.disconnect()` called; no reconnect scheduled |

### Acceptance Criteria — Phase 4
- [ ] All 11 unit tests pass (mocked `socket.io-client`)
- [ ] `transports: ['websocket']` — no fallback to polling
- [ ] Reconnect never fires after explicit `disconnect()`
- [ ] Exponential delays match `RECONNECT_DELAYS_MS` exactly
- [ ] Packet send always uses ACK callback (not fire-and-forget)

---

## Phase 5 — Packet Relay Service

**Goal**: Continuous loop that reads PENDING packets from SQLite and sends them via WebSocket, marks delivered on ACK.

### Files to Create

#### [NEW] `src/features/streaming/PacketRelayService.ts`
```typescript
export class PacketRelayService {
  private isRelaying = false;

  constructor(
    private readonly sqliteQueue: SqlitePacketQueue,
    private readonly wsClient: WebSocketClient,
    private readonly logger: MobileLogger,
  ) {}

  startRelay(): void { /* starts async relay loop */ }
  stopRelay(): void  { /* sets flag, loop exits */ }
  triggerReplay(): Promise<void> { /* force-drain all PENDING now */ }

  private async relayLoop(): Promise<void> {
    while (this.isRelaying) {
      if (wsClient.isConnected) {
        await this.relayPendingPackets();
      }
      await sleep(RELAY_POLL_INTERVAL_MS); // 250ms poll
    }
  }

  private async relayPendingPackets(): Promise<void> {
    const packets = await this.sqliteQueue.getPendingPackets(50);
    for (const packet of packets) {
      if (!this.wsClient.isConnected) break; // stop if disconnected mid-loop
      try {
        await this.wsClient.sendPacket(packet);
        await this.sqliteQueue.markDelivered(packet.localId);
      } catch (error) {
        this.logger.error({ error, sequenceNo: packet.sequenceNo }, 'Relay failed');
        // Leave PENDING — do NOT mark FAILED
        break;
      }
    }
  }
}
```

#### [NEW] `src/features/streaming/__tests__/PacketRelayService.spec.ts`

### TDD — Phase 5 Test Scenarios

| Test | Scenario |
|---|---|
| Relay loop — WS connected | Reads 50 packets, sends all, marks DELIVERED |
| Relay loop — WS disconnected | `getPendingPackets` NOT called; loop waits |
| Relay — send failure (transient) | Packet stays PENDING; loop does NOT mark FAILED |
| Relay — WS disconnects mid-loop | Loop breaks after first failure, tries again next poll |
| `triggerReplay` | Immediately drains all PENDING without waiting for poll interval |
| `stopRelay` | Loop exits cleanly; no pending `setTimeout` |
| Relay — empty queue | Returns quickly; no errors |
| Relay — batch of 51 packets | First batch: 50 sent; second poll sends remaining 1 |
| `startRelay` twice | Second call is no-op (idempotent) |

### Acceptance Criteria — Phase 5
- [ ] Packets always delivered in `session_id, sequence_no` order
- [ ] Transient failures leave packets as `PENDING`
- [ ] Relay never blocks the JS thread (all `async/await`)
- [ ] `stopRelay` guarantees no relay after return
- [ ] ≥ 80% coverage

---

## Phase 6 — Heartbeat Forwarder

**Goal**: Forward watch HEARTBEAT packets (received via BLE) to backend `POST /devices/:id/heartbeat`.

### Files to Create

#### [NEW] `src/features/heartbeat/HeartbeatForwarder.ts`
- Receives `AudioPacket` with `payloadType = 'HEARTBEAT'`
- Extracts `deviceId` from packet
- `POST /v1/devices/:deviceId/heartbeat` with `{ timestamp, batteryLevel, bleConnected, pendingPackets }`
- Logs response; on 404 → log error but don't crash
- On network error → silently retry on next heartbeat (60s interval is tolerant)

#### [NEW] `src/features/heartbeat/__tests__/HeartbeatForwarder.spec.ts`

### TDD — Phase 6 Test Scenarios

| Test | Scenario |
|---|---|
| Valid heartbeat — success | `POST /heartbeat` called with correct body; logs `serverTime` |
| Heartbeat — 404 device not found | Logs error, does NOT throw |
| Heartbeat — network timeout | Logs error, does NOT throw |
| Heartbeat — non-HEARTBEAT packet ignored | Function returns early |

---

## Phase 7 — Network Monitor & Recovery

**Goal**: Detect network connectivity changes. Trigger SQLite replay on network restore.

### Files to Create

#### [NEW] `src/features/streaming/NetworkMonitor.ts`
Uses `expo-network` (`NetInfoStateType`):
- `startMonitoring(callbacks)`: subscribe to connectivity changes
- `stopMonitoring()`: unsubscribe
- On `isConnected: false` → call `onDisconnected()`
- On `isConnected: true` (after was false) → call `onRestored()`

#### [NEW] `src/features/streaming/hooks/useNetworkMonitor.ts`
React hook wrapping `NetworkMonitor`.

#### [NEW] `src/features/streaming/__tests__/NetworkMonitor.spec.ts`

### Integration: Network + Relay

In `PacketRelayService` (Phase 5), wire:
```typescript
networkMonitor.startMonitoring({
  onDisconnected: () => relayService.stopRelay(),
  onRestored: () => { relayService.startRelay(); void relayService.triggerReplay(); },
});
```

### TDD — Phase 7 Test Scenarios

| Test | Scenario |
|---|---|
| `onDisconnected` fires | Relay stops; `getPendingPackets` no longer called |
| `onRestored` fires | Relay resumes; `triggerReplay()` called immediately |
| Both events in sequence | Stops → restarts correctly |
| Monitor cleanup | `stopMonitoring` removes listener |

---

## Phase 8 — OTA Coordinator

**Goal**: Receive `ota:available` from backend. Download firmware. Chunk and send to watch via BLE `CONTROL_RX`.

### Files to Create

#### [NEW] `src/features/ota/OtaCoordinator.ts`
- Listen for `ota:available` WebSocket event
- Download firmware binary via HTTPS (`expo-file-system`)
- Verify SHA-256 of downloaded file (`expo-crypto`)
- Split into 450-byte chunks
- Send each chunk via `CONTROL_RX` BLE characteristic write
  - `OTA_START (0x10)` → version
  - `OTA_CHUNK (0x11)` × N → data
  - `OTA_END (0x12)` → SHA-256 hash (32 bytes)
- On any failure: abort and log; do NOT partially apply

#### [NEW] `src/features/ota/__tests__/OtaCoordinator.spec.ts`

### TDD — Phase 8 Test Scenarios

| Test | Scenario |
|---|---|
| SHA-256 mismatch after download | Abort; `CONTROL_RX` write NOT called |
| SHA-256 match | OTA_START → OTA_CHUNK × N → OTA_END sent in order |
| BLE write failure mid-chunk | Abort; remaining chunks NOT sent |
| `ota:available` ignored if not connected | Early return; no download attempt |

---

## Phase 9 — UI Status Screen

**Goal**: Minimal status screen showing BLE connection state, packet queue depth, WebSocket state.

### Files to Create

#### [NEW] `src/stores/connectionStore.ts`
Zustand store:
```typescript
interface ConnectionStore {
  bleState: BleConnectionState;
  wsConnected: boolean;
  pendingPacketCount: number;
  lastHeartbeatAt: number | null;
  setBleState(state: BleConnectionState): void;
  setWsConnected(connected: boolean): void;
  setPendingPacketCount(count: number): void;
}
```

#### [NEW] `src/navigation/AppNavigator.tsx`
Stack navigator with single `StatusScreen`.

#### [NEW] `src/screens/StatusScreen.tsx`
Displays:
- BLE connection state (dot indicator: green/red/yellow)
- WebSocket connection state
- Pending packet count (updates every 5s)
- Last heartbeat timestamp

> **Rule**: No business logic in `StatusScreen`. Read from Zustand store only.

#### [NEW] `src/App.tsx`
- Initialize `SqlitePacketQueue`
- Start `BleConnectionService`, `WebSocketClient`, `PacketRelayService`, `NetworkMonitor`
- Wire callbacks to update Zustand store

---

## Full Directory Structure (Final Target)

```
apps/mobile/
├── src/
│   ├── App.tsx
│   ├── features/
│   │   ├── bluetooth/
│   │   │   ├── BleManager.ts
│   │   │   ├── hooks/
│   │   │   │   ├── useBluetoothConnection.ts
│   │   │   │   └── useBlePacketStream.ts
│   │   │   ├── services/
│   │   │   │   ├── BleConnectionService.ts
│   │   │   │   └── BlePacketService.ts
│   │   │   ├── types/
│   │   │   │   └── BleConnectionState.ts
│   │   │   ├── utils/
│   │   │   │   └── packet-deserializer.ts
│   │   │   └── __tests__/
│   │   │       ├── BlePacketService.spec.ts
│   │   │       └── BleConnectionService.spec.ts
│   │   ├── streaming/
│   │   │   ├── WebSocketClient.ts
│   │   │   ├── PacketRelayService.ts
│   │   │   ├── NetworkMonitor.ts
│   │   │   ├── hooks/
│   │   │   │   ├── useWebSocketConnection.ts
│   │   │   │   └── useNetworkMonitor.ts
│   │   │   └── __tests__/
│   │   │       ├── WebSocketClient.spec.ts
│   │   │       ├── PacketRelayService.spec.ts
│   │   │       └── NetworkMonitor.spec.ts
│   │   ├── storage/
│   │   │   ├── SqlitePacketQueue.ts
│   │   │   ├── migrations/
│   │   │   │   └── 001_create_packet_queue.sql
│   │   │   └── __tests__/
│   │   │       └── SqlitePacketQueue.spec.ts
│   │   ├── heartbeat/
│   │   │   ├── HeartbeatForwarder.ts
│   │   │   └── __tests__/
│   │   │       └── HeartbeatForwarder.spec.ts
│   │   └── ota/
│   │       ├── OtaCoordinator.ts
│   │       └── __tests__/
│   │           └── OtaCoordinator.spec.ts
│   ├── shared/
│   │   ├── constants/
│   │   │   └── ble.constants.ts
│   │   ├── errors/
│   │   │   ├── BleConnectionError.ts
│   │   │   ├── BleCharacteristicError.ts
│   │   │   ├── PacketValidationError.ts
│   │   │   ├── SqliteStorageError.ts
│   │   │   └── WebSocketSendError.ts
│   │   ├── types/
│   │   │   ├── AudioPacket.ts
│   │   │   └── PacketStatus.ts
│   │   └── utils/
│   │       ├── checksum.ts
│   │       └── logger.ts
│   ├── stores/
│   │   └── connectionStore.ts
│   ├── navigation/
│   │   └── AppNavigator.tsx
│   └── screens/
│       └── StatusScreen.tsx
├── __mocks__/
│   ├── react-native-ble-plx.ts
│   └── expo-sqlite.ts
├── android/
├── plans/
│   └── implementation_plan.md    ← (this file)
├── .env.example
├── .eslintrc.json
├── .prettierrc
├── babel.config.js
├── jest.config.ts
├── metro.config.js
├── package.json
└── tsconfig.json
```

---

## Non-Negotiable Rules (from `mobile.prompt.md`)

1. **No `any`** — use `unknown` + explicit narrowing
2. **No `console.log`** — use `MobileLogger`
3. **No BLE calls in React components** — only via services
4. **No SQLite calls in React components** — only via `SqlitePacketQueue`
5. **Always verify CRC32 checksum** before calling `onPacketReceived`
6. **Transient failures leave packet PENDING** — never mark FAILED on network error
7. **All `useEffect` subscriptions cleaned up** in return function
8. **No magic numbers** — all in `ble.constants.ts`
9. **Path alias `@/`** for all internal imports
10. **TDD**: write spec first, red → green → refactor, ≥ 80% coverage

---

## Verification Plan

### Automated Tests
```bash
cd apps/mobile
npm test                          # Unit tests
npm run test:coverage             # Coverage (≥ 80%)
npx expo run:android              # Build + install on device
npx detox test -c android.debug   # E2E (requires connected device)
```

### Manual Verification (Physical Device)
1. Build dev client: `npx expo run:android`
2. Open app → Status screen shows BLE: SCANNING
3. Power on Samsung Galaxy Watch → BLE state changes to CONNECTED
4. Start backend (`apps/backend`) → WS state changes to CONNECTED
5. Speak near watch → verify packets appear in backend DB
6. Disconnect phone WiFi → SQLite queue fills
7. Reconnect WiFi → packets relay, queue drains
8. Verify zero crashes after 10min recording session
