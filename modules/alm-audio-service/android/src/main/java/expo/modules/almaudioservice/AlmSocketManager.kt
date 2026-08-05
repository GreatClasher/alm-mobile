package expo.modules.almaudioservice

import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URI

class AlmSocketManager(
    private val wsUrl: String,
    private val deviceId: String,
    private val userId: String,
    private val token: String,
    private val onAssistantResponse: (String, String?) -> Unit,
    private val onPacketSent: () -> Unit
) {
    private val TAG = "AlmSocketManager"
    private var socket: Socket? = null

    fun connect() {
        try {
            val options = IO.Options()
            options.transports = arrayOf(io.socket.engineio.client.transports.WebSocket.NAME)
            
            val authMap = mapOf("token" to token)
            options.auth = authMap

            socket = IO.socket(URI.create(wsUrl), options)
            
            socket?.on(Socket.EVENT_CONNECT) {
                Log.i(TAG, "Socket connected to $wsUrl")
            }

            socket?.on(Socket.EVENT_DISCONNECT) {
                Log.i(TAG, "Socket disconnected")
            }

            socket?.on(Socket.EVENT_CONNECT_ERROR) { args ->
                Log.e(TAG, "Socket connect error: ${args.contentToString()}")
            }

            socket?.on("assistant:response") { args ->
                if (args.isNotEmpty()) {
                    val data = args[0] as JSONObject
                    val answer = data.optString("answer")
                    val prompt = if (data.has("prompt")) data.optString("prompt") else null
                    if (answer.isNotEmpty()) {
                        onAssistantResponse(answer, prompt)
                    }
                }
            }

            socket?.connect()
        } catch (e: Exception) {
            Log.e(TAG, "Error initializing socket", e)
        }
    }

    fun disconnect() {
        socket?.disconnect()
        socket = null
    }

    fun emitAudioPacket(packet: ByteArray) {
        if (socket?.connected() == true) {
            try {
                if (packet.size < 55) return

                val payloadTypeByte = packet[3].toInt()
                // Accept AUDIO (0x01), ACTIVE_QUERY (0x05), and ACTIVE_QUERY_END (0x06)
                if (payloadTypeByte != 0x01 && payloadTypeByte != 0x05 && payloadTypeByte != 0x06) return

                val flags = packet[4].toInt()
                val isWakeWordActive = (flags and 0x01) != 0

                val buffer = java.nio.ByteBuffer.wrap(packet)
                buffer.order(java.nio.ByteOrder.BIG_ENDIAN)

                val sequenceNo = buffer.getInt(5)
                val timestamp = buffer.getLong(9)
                
                val deviceIdBytes = packet.sliceArray(17..32)
                val sessionIdBytes = packet.sliceArray(33..48)
                val deviceIdStr = formatUUID(deviceIdBytes)
                val sessionIdStr = formatUUID(sessionIdBytes)

                val payloadLen = buffer.getShort(49).toInt() and 0xFFFF
                val checksumRaw = buffer.getInt(51)
                val checksumStr = String.format("%08x", checksumRaw)

                if (packet.size < 55 + payloadLen) return

                val payloadBytes = packet.sliceArray(55 until 55 + payloadLen)
                val payloadBase64 = android.util.Base64.encodeToString(payloadBytes, android.util.Base64.NO_WRAP)

                val payloadTypeStr = when {
                    payloadTypeByte == 0x06 -> "ACTIVE_QUERY_END"
                    payloadTypeByte == 0x05 || isWakeWordActive -> "ACTIVE_QUERY"
                    else -> "AUDIO"
                }

                val payload = JSONObject()
                payload.put("deviceId", deviceIdStr) // Use deviceId from packet to match JS logic
                payload.put("sessionId", sessionIdStr)
                payload.put("sequenceNo", sequenceNo)
                payload.put("timestamp", timestamp)
                payload.put("payloadType", payloadTypeStr)
                payload.put("payload", payloadBase64)
                payload.put("checksum", checksumStr)
                
                socket?.emit("audio:packet", payload, io.socket.client.Ack { args ->
                    if (args.isNotEmpty()) {
                        val response = args[0] as? JSONObject
                        val status = response?.optString("status")
                        if (status == "accepted") {
                            onPacketSent()
                        }
                    }
                })
            } catch (e: Exception) {
                Log.e(TAG, "Error emitting audio packet", e)
            }
        }
    }

    private fun formatUUID(bytes: ByteArray): String {
        val hex = bytes.joinToString("") { "%02x".format(it) }
        return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}"
    }
}
