package expo.modules.almaudioservice

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class AlmAudioConfig : Record {
  @Field var deviceId: String = ""
  @Field var userId: String = ""
  @Field var wsUrl: String = ""
  @Field var token: String = ""
  @Field var porcupineAccessKey: String = ""
}

class AlmAudioServiceModule : Module() {
  private var bleManager: AlmBleManager? = null
  private var audioProcessor: AlmAudioProcessor? = null
  private var socketManager: AlmSocketManager? = null

  // Each module class must implement the definition function. The definition consists of components
  // that describes the module's functionality and behavior.
  // See https://docs.expo.dev/modules/module-api for more details about available components.
  override fun definition() = ModuleDefinition {
    // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
    // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
    // The module will be accessible from `requireNativeModule('AlmAudioService')` in JavaScript.
    Name("AlmAudioService")

    Events("onWakeWordDetected", "onAssistantResponse", "onBlePacket", "onAudioPacketReceived", "onAudioPacketSent")

    AsyncFunction("startService") { config: AlmAudioConfig ->
      val deviceId = config.deviceId
      val userId = config.userId
      val wsUrl = config.wsUrl
      val token = config.token
      val porcupineAccessKey = config.porcupineAccessKey

      socketManager = AlmSocketManager(
          wsUrl = wsUrl, 
          deviceId = deviceId, 
          userId = userId,
          token = token,
          onAssistantResponse = { answer, prompt ->
              val eventData = mutableMapOf<String, Any>("answer" to answer)
              if (prompt != null) {
                  eventData["prompt"] = prompt
              }
              sendEvent("onAssistantResponse", eventData)
          },
          onPacketSent = {
              sendEvent("onAudioPacketSent", emptyMap<String, Any>())
          }
      )
      socketManager?.connect()

      audioProcessor = AlmAudioProcessor(appContext.reactContext!!, porcupineAccessKey) {
          sendEvent("onWakeWordDetected", emptyMap<String, Any>())
      }
      audioProcessor?.start()

      bleManager = AlmBleManager(appContext.reactContext!!) { packet ->
          if (packet.size >= 4) {
              val payloadType = packet[3].toInt()
              if (payloadType == 0x01 || payloadType == 0x05 || payloadType == 0x06) {
                  // AUDIO: Send via native WebSocket and process wake word natively
                  socketManager?.emitAudioPacket(packet)
                  if (payloadType == 0x01) {
                      audioProcessor?.processBlePacket(packet)
                  }
                  sendEvent("onAudioPacketReceived", mapOf("type" to payloadType))
              } else {
                  // NON-AUDIO (e.g. Heartbeat): Send to JS over bridge
                  val base64String = android.util.Base64.encodeToString(packet, android.util.Base64.NO_WRAP)
                  sendEvent("onBlePacket", mapOf("data" to base64String))
              }
          }
      }
      bleManager?.start()

      println("AlmAudioService: Service started natively with device $deviceId")
    }

    AsyncFunction("stopService") {
      bleManager?.stop()
      audioProcessor?.stop()
      socketManager?.disconnect()
      
      bleManager = null
      audioProcessor = null
      socketManager = null

      println("AlmAudioService: Service stopped")
    }
  }
}
