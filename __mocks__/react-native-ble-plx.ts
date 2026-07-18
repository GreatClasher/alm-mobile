/**
 * Mock for react-native-ble-plx
 * Provides full manual mocks of BleManager, Device, and Characteristic
 * for Jest unit tests. All methods return controlled test doubles.
 */

export type UUID = string;

export interface Characteristic {
  readonly uuid: UUID;
  readonly serviceUUID: UUID;
  readonly deviceID: string;
  value: string | null;
  monitor(
    listener: (error: Error | null, characteristic: Characteristic | null) => void,
  ): { remove: () => void };
  writeWithResponse(valueBase64: string): Promise<Characteristic>;
  writeWithoutResponse(valueBase64: string): Promise<Characteristic>;
}

export interface Device {
  readonly id: string;
  readonly name: string | null;
  connect(): Promise<Device>;
  discoverAllServicesAndCharacteristics(): Promise<Device>;
  requestMTU(mtu: number): Promise<Device>;
  monitorCharacteristicForService(
    serviceUUID: UUID,
    characteristicUUID: UUID,
    listener: (error: Error | null, characteristic: Characteristic | null) => void,
  ): { remove: () => void };
  writeCharacteristicWithResponseForService(
    serviceUUID: UUID,
    characteristicUUID: UUID,
    valueBase64: string,
  ): Promise<Characteristic>;
  cancelConnection(): Promise<Device>;
  onDisconnected(
    listener: (error: Error | null, device: Device) => void,
  ): { remove: () => void };
  isConnected(): Promise<boolean>;
}

export type ScanCallbackType = (
  error: Error | null,
  device: Device | null,
) => void;

export class BleManager {
  startDeviceScan = jest.fn(
    (_uuids: UUID[] | null, _options: unknown, callback: ScanCallbackType): void => {
      void _uuids;
      void _options;
      void callback;
    },
  );

  stopDeviceScan = jest.fn((): void => {
    // no-op mock
  });

  connectToDevice = jest.fn((_deviceId: string): Promise<Device> => {
    return Promise.resolve(createMockDevice(_deviceId));
  });

  monitorCharacteristicForDevice = jest.fn(
    (
      _deviceId: string,
      _serviceUUID: UUID,
      _characteristicUUID: UUID,
      listener: (error: Error | null, characteristic: Characteristic | null) => void,
    ): { remove: () => void } => {
      void listener;
      return { remove: jest.fn() };
    },
  );

  writeCharacteristicWithResponseForDevice = jest.fn(
    (
      _deviceId: string,
      _serviceUUID: UUID,
      _characteristicUUID: UUID,
      _valueBase64: string,
    ): Promise<Characteristic> => {
      return Promise.resolve(createMockCharacteristic());
    },
  );

  writeCharacteristicWithoutResponseForDevice = jest.fn(
    (
      _deviceId: string,
      _serviceUUID: UUID,
      _characteristicUUID: UUID,
      _valueBase64: string,
    ): Promise<Characteristic> => {
      return Promise.resolve(createMockCharacteristic());
    },
  );

  cancelDeviceConnection = jest.fn((_deviceId: string): Promise<Device> => {
    return Promise.resolve(createMockDevice(_deviceId));
  });

  onDeviceDisconnected = jest.fn(
    (
      _deviceId: string,
      listener: (error: Error | null, device: Device) => void,
    ): { remove: () => void } => {
      void listener;
      return { remove: jest.fn() };
    },
  );

  isDeviceConnected = jest.fn((_deviceId: string): Promise<boolean> => {
    return Promise.resolve(false);
  });

  destroy = jest.fn((): void => {
    // no-op mock
  });
}

export function createMockDevice(id = 'mock-device-id', name = 'MockWatch'): Device {
  return {
    id,
    name,
    connect: jest.fn(function (this: Device): Promise<Device> {
      return Promise.resolve(this);
    }),
    discoverAllServicesAndCharacteristics: jest.fn(function (this: Device): Promise<Device> {
      return Promise.resolve(this);
    }),
    requestMTU: jest.fn(function (this: Device, _mtu: number): Promise<Device> {
      return Promise.resolve(this);
    }),
    monitorCharacteristicForService: jest.fn(
      (
        _serviceUUID: UUID,
        _characteristicUUID: UUID,
        listener: (error: Error | null, characteristic: Characteristic | null) => void,
      ): { remove: () => void } => {
        void listener;
        return { remove: jest.fn() };
      },
    ),
    writeCharacteristicWithResponseForService: jest.fn(
      (
        _serviceUUID: UUID,
        _characteristicUUID: UUID,
        _valueBase64: string,
      ): Promise<Characteristic> => {
        return Promise.resolve(createMockCharacteristic());
      },
    ),
    cancelConnection: jest.fn(function (this: Device): Promise<Device> {
      return Promise.resolve(this);
    }),
    onDisconnected: jest.fn(
      (
        listener: (error: Error | null, device: Device) => void,
      ): { remove: () => void } => {
        void listener;
        return { remove: jest.fn() };
      },
    ),
    isConnected: jest.fn((): Promise<boolean> => Promise.resolve(true)),
  };
}

export function createMockCharacteristic(
  uuid = 'mock-char-uuid',
  serviceUUID = 'mock-service-uuid',
  deviceID = 'mock-device-id',
): Characteristic {
  return {
    uuid,
    serviceUUID,
    deviceID,
    value: null,
    monitor: jest.fn(
      (
        listener: (error: Error | null, characteristic: Characteristic | null) => void,
      ): { remove: () => void } => {
        void listener;
        return { remove: jest.fn() };
      },
    ),
    writeWithResponse: jest.fn(function (
      this: Characteristic,
      _valueBase64: string,
    ): Promise<Characteristic> {
      return Promise.resolve(this);
    }),
    writeWithoutResponse: jest.fn(function (
      this: Characteristic,
      _valueBase64: string,
    ): Promise<Characteristic> {
      return Promise.resolve(this);
    }),
  };
}

export default { BleManager };
