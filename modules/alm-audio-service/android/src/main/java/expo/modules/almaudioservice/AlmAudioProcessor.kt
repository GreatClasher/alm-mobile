package expo.modules.almaudioservice

import android.content.Context
import android.util.Log
import ai.picovoice.porcupine.Porcupine
import io.github.jaredmdobson.OpusDecoder
import java.nio.ByteBuffer

class AlmAudioProcessor(
    private val context: Context,
    private val accessKey: String,
    private val onWakeWord: () -> Unit
) {
    private val TAG = "AlmAudioProcessor"
    private var porcupine: Porcupine? = null
    private var opusDecoder: OpusDecoder? = null

    // Buffer to accumulate PCM samples for Porcupine
    private val pcmBuffer = mutableListOf<Short>()

    fun start() {
        try {
            // Initialize Concentus Opus Decoder (16kHz, 1 channel)
            opusDecoder = OpusDecoder(16000, 1)

            // Initialize Picovoice Porcupine (Built-in keyword "Porcupine" or custom)
            porcupine = Porcupine.Builder()
                .setAccessKey(accessKey)
                .setKeyword(Porcupine.BuiltInKeyword.PORCUPINE) // We will use "Porcupine" built-in as proxy for "Jabbel" for testing
                .build(context)

            Log.i(TAG, "AudioProcessor started with frame length ${porcupine?.frameLength}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start AudioProcessor", e)
        }
    }

    fun stop() {
        porcupine?.delete()
        porcupine = null
        opusDecoder = null
    }

    fun processBlePacket(packet: ByteArray) {
        if (packet.size < 55) return
        
        val magic = ((packet[0].toInt() and 0xFF) shl 8) or (packet[1].toInt() and 0xFF)
        if (magic != 0x4A50) return // PACKET_MAGIC

        val payloadType = packet[3].toInt()
        if (payloadType != 0x01) return // 0x01 is AUDIO

        val payloadLen = ((packet[49].toInt() and 0xFF) shl 8) or (packet[50].toInt() and 0xFF)
        
        if (packet.size < 55 + payloadLen) return

        val opusPayload = packet.copyOfRange(55, 55 + payloadLen)
        
        decodeAndProcess(opusPayload)
    }

    private fun decodeAndProcess(opusPayload: ByteArray) {
        val decoder = opusDecoder ?: return
        val porcupineEngine = porcupine ?: return

        try {
            // A 20ms frame at 16kHz is 320 samples. Maximum reasonable buffer is 960 (60ms).
            val decodedShorts = ShortArray(960)
            
            val decodedSamples = decoder.decode(opusPayload, 0, opusPayload.size, decodedShorts, 0, decodedShorts.size, false)
            
            if (decodedSamples > 0) {
                // Add to accumulation buffer
                for (i in 0 until decodedSamples) {
                    pcmBuffer.add(decodedShorts[i])
                }

                // Process chunks of porcupine.frameLength (usually 512)
                val frameLength = porcupineEngine.frameLength
                while (pcmBuffer.size >= frameLength) {
                    val frame = ShortArray(frameLength)
                    for (i in 0 until frameLength) {
                        frame[i] = pcmBuffer[i]
                    }
                    
                    // Remove processed frame from buffer
                    pcmBuffer.subList(0, frameLength).clear()

                    val keywordIndex = porcupineEngine.process(frame)
                    if (keywordIndex >= 0) {
                        Log.i(TAG, "WAKE WORD DETECTED!")
                        onWakeWord()
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error decoding or processing audio", e)
        }
    }
}
