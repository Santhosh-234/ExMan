package expo.modules.vibelistener

import android.content.Context
import android.content.Intent
import android.provider.Settings
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
