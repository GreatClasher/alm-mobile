import { NativeModulesProxy, EventEmitter, Subscription } from 'expo-modules-core';
import AlmAudioServiceModule from './AlmAudioServiceModule';

export interface AlmAudioConfig {
  deviceId: string;
  userId: string;
  wsUrl: string;
  token: string;
  porcupineAccessKey: string;
}

export function startService(config: AlmAudioConfig) {
  return AlmAudioServiceModule.startService(config);
}

export function stopService() {
  return AlmAudioServiceModule.stopService();
}

const emitter = new EventEmitter(AlmAudioServiceModule ?? NativeModulesProxy.AlmAudioService);

export function addAssistantResponseListener(listener: (event: { answer: string, prompt?: string }) => void): Subscription {
  return emitter.addListener('onAssistantResponse', listener);
}

export function addWakeWordDetectedListener(listener: () => void): Subscription {
  return emitter.addListener('onWakeWordDetected', listener);
}

export function addBlePacketListener(listener: (event: { data: string }) => void): Subscription {
  return emitter.addListener('onBlePacket', listener);
}

export function addAudioPacketListener(listener: () => void): Subscription {
  return emitter.addListener('onAudioPacketReceived', listener);
}

export function addAudioPacketSentListener(listener: () => void): Subscription {
  return emitter.addListener('onAudioPacketSent', listener);
}
