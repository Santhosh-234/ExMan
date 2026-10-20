package expo.modules.vibelistener

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import org.json.JSONObject
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VibeListenerModule : Module() {
  companion object {
    @Volatile var instance: VibeListenerModule? = null
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  fun emitRaw() = sendEvent("onRaw", mapOf<String, Any>())

  override fun definition() = ModuleDefinition {
    Name("VibeListener")
    Events("onRaw")

    OnCreate { instance = this@VibeListenerModule }
    OnDestroy { if (instance === this@VibeListenerModule) instance = null }

    Function("drain") { Queue.drain(context) }

    // Reads existing inbox messages (needs READ_SMS). Only alphanumeric sender IDs (banks/apps), never
    // personal numbers; the parser then drops anything that is not a transaction.
    Function("readInbox") { sinceMs: Double ->
      val out = mutableListOf<String>()
      context.contentResolver.query(
        Uri.parse("content://sms/inbox"),
        arrayOf("address", "body", "date"),
        "date >= ?",
        arrayOf(sinceMs.toLong().toString()),
        "date ASC",
      )?.use { c ->
        while (c.moveToNext()) {
          val addr = c.getString(0) ?: continue
          if (!addr.any { it.isLetter() }) continue
          out.add(
            JSONObject().put("kind", "sms").put("sender", addr).put("text", c.getString(1) ?: "")
              .put("ts", c.getLong(2)).toString()
          )
        }
      }
      out
    }

    Function("notificationAccessGranted") {
      NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }

    Function("openNotificationAccessSettings") {
      context.startActivity(
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }
  }
}
