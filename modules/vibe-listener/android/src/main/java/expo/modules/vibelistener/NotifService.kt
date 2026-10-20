package expo.modules.vibelistener

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class NotifService : NotificationListenerService() {
  // ponytail: hardcoded package list; make it a user setting if another UPI app is needed
  private val apps = setOf(
    "com.google.android.apps.nbu.paisa.user", // GPay
    "com.phonepe.app",
    "net.one97.paytm",
  )

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (sbn.packageName !in apps) return
    val extras = sbn.notification.extras
    val text = listOfNotNull(
      extras.getCharSequence(Notification.EXTRA_TITLE),
      extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT),
    ).joinToString(". ")
    if (text.isNotBlank()) Queue.push(this, "notif", sbn.packageName, text, sbn.postTime)
  }
}
