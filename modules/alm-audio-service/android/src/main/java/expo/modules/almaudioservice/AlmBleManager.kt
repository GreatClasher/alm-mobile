package expo.modules.almaudioservice

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.ParcelUuid
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

@SuppressLint("MissingPermission")
class AlmBleManager(
    private val context: Context,
    private val onPacketReceived: (ByteArray) -> Unit
) {
    private val TAG = "AlmBleManager"
    
    private val SERVICE_UUID = UUID.fromString("0000AABB-0000-1000-8000-00805F9B34FB")
    private val AUDIO_CHAR_UUID = UUID.fromString("0000AABC-0000-1000-8000-00805F9B34FB")
    private val HEARTBEAT_CHAR_UUID = UUID.fromString("0000AABD-0000-1000-8000-00805F9B34FB")
    private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB")

    private val bluetoothManager: BluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager.adapter
    private var bluetoothGatt: BluetoothGatt? = null
    
    private var isScanning = false

    private val scope = CoroutineScope(Dispatchers.IO)

    fun start() {
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled) {
            Log.e(TAG, "Bluetooth not enabled or available")
            return
        }
        
        startScan()
    }

    private fun startScan() {
        val scanner = bluetoothAdapter?.bluetoothLeScanner
        if (scanner == null) {
            Log.e(TAG, "BluetoothLeScanner is null")
            return
        }
        
        val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        
        Log.i(TAG, "Starting BLE scan for ALM service...")
        isScanning = true
        scanner.startScan(listOf(filter), settings, scanCallback)
        
        scope.launch {
            delay(30000)
            if (isScanning) {
                Log.w(TAG, "Scan timeout reached, stopping scan")
                stopScan()
            }
        }
    }
    
    private fun stopScan() {
        if (!isScanning) return
        isScanning = false
        bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device
            Log.i(TAG, "Found ALM device via scan: ${device.address}")
            stopScan()
            connectToDevice(device)
        }

        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "BLE Scan failed with code $errorCode")
            isScanning = false
        }
    }

    private fun connectToDevice(device: BluetoothDevice) {
        if (bluetoothGatt != null) return // Already connecting/connected to a device
        
        Log.i(TAG, "Connecting to GATT server on ${device.address}")
        bluetoothGatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    }

    fun stop() {
        stopScan()
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
        bluetoothGatt = null
    }

    private var pendingDescriptorWrites = mutableListOf<BluetoothGattDescriptor>()

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                Log.i(TAG, "GATT Connected to: ${gatt.device.address}. Discovering services...")
                gatt.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                Log.i(TAG, "GATT Disconnected from: ${gatt.device.address}")
                if (gatt == bluetoothGatt) {
                    bluetoothGatt?.close()
                    bluetoothGatt = null
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                val service = gatt.getService(SERVICE_UUID)
                if (service != null) {
                    Log.i(TAG, "Services discovered. ALM Service found on ${gatt.device.address}. Requesting MTU 512...")
                    bluetoothGatt = gatt
                    gatt.requestMtu(512)
                } else {
                    Log.i(TAG, "Services discovered, but ALM Service NOT found on ${gatt.device.address}. Ignoring.")
                    gatt.disconnect()
                }
            } else {
                Log.w(TAG, "onServicesDiscovered received: $status")
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            Log.i(TAG, "MTU changed to $mtu (status: $status). Subscribing to characteristics...")
            subscribeToCharacteristics(gatt)
        }

        @Suppress("OVERRIDE_DEPRECATION")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            @Suppress("DEPRECATION")
            val data = characteristic.value
            if (data != null && data.isNotEmpty()) {
                onPacketReceived(data)
            }
        }

        @Suppress("OVERRIDE_DEPRECATION")
        override fun onDescriptorWrite(
            gatt: BluetoothGatt,
            descriptor: BluetoothGattDescriptor,
            status: Int
        ) {
            Log.i(TAG, "Descriptor written for char: ${descriptor.characteristic.uuid} with status: $status")
            if (pendingDescriptorWrites.isNotEmpty()) {
                val nextDescriptor = pendingDescriptorWrites.removeAt(0)
                Log.i(TAG, "Writing next descriptor for char: ${nextDescriptor.characteristic.uuid}")
                @Suppress("DEPRECATION")
                nextDescriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                @Suppress("DEPRECATION")
                gatt.writeDescriptor(nextDescriptor)
            } else {
                Log.i(TAG, "All descriptors written successfully.")
            }
        }
    }

    private fun subscribeToCharacteristics(gatt: BluetoothGatt) {
        val service = gatt.getService(SERVICE_UUID)
        if (service == null) {
            Log.e(TAG, "ALM Service not found on device")
            return
        }

        val audioChar = service.getCharacteristic(AUDIO_CHAR_UUID)
        val hbChar = service.getCharacteristic(HEARTBEAT_CHAR_UUID)
        pendingDescriptorWrites.clear()

        var firstDescriptor: BluetoothGattDescriptor? = null

        if (audioChar != null) {
            gatt.setCharacteristicNotification(audioChar, true)
            val descriptor = audioChar.getDescriptor(CCCD_UUID)
            if (descriptor != null) {
                firstDescriptor = descriptor
            }
        }

        if (hbChar != null) {
            gatt.setCharacteristicNotification(hbChar, true)
            val descriptor = hbChar.getDescriptor(CCCD_UUID)
            if (descriptor != null) {
                if (firstDescriptor == null) {
                    firstDescriptor = descriptor
                } else {
                    pendingDescriptorWrites.add(descriptor)
                }
            }
        }

        if (firstDescriptor != null) {
            Log.i(TAG, "Writing first descriptor for char: ${firstDescriptor.characteristic.uuid}")
            @Suppress("DEPRECATION")
            firstDescriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            @Suppress("DEPRECATION")
            gatt.writeDescriptor(firstDescriptor)
        }
    }
}
