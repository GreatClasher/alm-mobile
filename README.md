# JabbelPin Mobile App

React Native companion app built with Expo bare workflow. Responsible for relaying audio packets from the Galaxy Watch to the backend over WebSocket.

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   The app will autonomously generate a device ID, register with the backend, and securely store the JWT token automatically. 
   You only need to configure the backend connection in your `.env` file (ensure these point to your running ngrok tunnel if developing locally):
   ```
   EXPO_PUBLIC_WS_URL=wss://equinox-bottle-landed.ngrok-free.dev
   EXPO_PUBLIC_API_BASE_URL=https://equinox-bottle-landed.ngrok-free.dev/v1
   ```

3. **Native Modules**
   Since this app uses native modules (`react-native-ble-plx`, `expo-sqlite`), it must be run as a dev client, not inside Expo Go.
   ```bash
   npx expo prebuild
   ```

## Running the App

```bash
# Start Metro and launch on Android emulator/device
npx expo run:android

# Start Metro only
npx expo start
```

## Testing

```bash
npm test
```
