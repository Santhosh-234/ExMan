package expo.modules.vibelistener

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    // multipart SMS arrive as several PDUs from the same sender: join them
    Telephony.Sms.Intents.getMessagesFromIntent(intent)
      .groupBy { it.originatingAddress ?: "" }
      .forEach { (sender, parts) ->
        Queue.push(context, "sms", sender, parts.joinToString("") { it.messageBody ?: "" }, parts.first().timestampMillis)
      }
  }
}
