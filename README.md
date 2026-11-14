# ALM Mobile Edge Client — Real-Time Audio Relay & Device Companion

[![React Native](https://img.shields.io/badge/React%20Native-0.74-61dafb.svg)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-51-black.svg)](https://expo.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/Storage-SQLite%20Offline%20Queue-003B57.svg)](https://docs.expo.dev/versions/latest/sdk/sqlite/)

A resilient React Native edge client built with Expo bare workflow. Responsible for pairing with BLE edge audio hardware, managing local packet queuing via SQLite during cellular network drops, and streaming low-latency Opus audio packets over secure WebSockets to the distributed ingestion gateway.

---

## 🚀 Key Architectural Features

- **BLE Device Ingestion (`react-native-ble-plx`)**: Low-energy GATT client handling peripheral discovery, MTU negotiation (up to 512 bytes), and streaming chunk assembly.
- **Offline Resilient Packet Queue (`expo-sqlite`)**: Persistent FIFO buffer holding encrypted audio frames locally when cellular or Wi-Fi connectivity drops, automatically flushing upon reconnect.
- **Bi-directional WebSocket Gateway**: Real-time chunk streaming with sub-100ms packet delivery, session heartbeat, and automatic JWT rotation.
- **Hardware Cryptographic Identity (`expo-secure-store`)**: Secure on-device key management ensuring every streamed payload is cryptographically authenticated.

---

## 🏛️ Edge Ingestion Architecture

```mermaid
sequenceDiagram
    autonumber
    participant Hardware as Edge Device (BLE Peripheral)
    participant Mobile as ALM Mobile Companion (React Native)
    participant SQLite as Local SQLite Store
    participant Gateway as NestJS WebSocket Gateway

    Hardware->>Mobile: Stream Audio Packets (BLE GATT Notification)
    alt Network Connected
        Mobile->>Gateway: Forward Encrypted Chunks (WebSocket)
        Gateway-->>Mobile: Frame ACK + Traceparent Response
    else Network Disconnected
        Mobile->>SQLite: Persist Frame to Offline FIFO Table
        Note over Mobile,SQLite: Buffer offline data with exponential backoff retry
    end

    opt Reconnection Event
        Mobile->>Gateway: Re-establish Socket Handshake
        Mobile->>SQLite: Dequeue Stored Chunks
        Mobile->>Gateway: Flush Buffered Frames
    end
```

---

## 🛠️ Setup & Development

### 1. Prerequisites
- **Node.js 18+**
- **Android SDK & NDK** (for Android build) or Xcode (for iOS build)
- **Running NestJS Backend**

### 2. Configuration
Copy the sample environment file:
```bash
cp .env.example .env
```
Update URLs to point to your local backend or tunnel:
```env
EXPO_PUBLIC_WS_URL=ws://localhost:3000
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000/v1
```

### 3. Installation
```bash
npm install
npx expo prebuild
```

### 4. Running
```bash
# Launch on Android emulator or connected device
npx expo run:android

# Launch on iOS simulator
npx expo run:ios
```

### 5. Running Tests & Typechecks
```bash
npm test
npm run typecheck
npm run lint
```
