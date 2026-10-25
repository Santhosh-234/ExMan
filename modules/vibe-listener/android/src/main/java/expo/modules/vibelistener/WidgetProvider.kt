package expo.modules.vibelistener

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * Home-screen widget: a short line of what is safe to spend and what is due next, plus a "+" that opens the add screen.
 * The app writes the three texts (setWidget) whenever it has fresh numbers; the widget only displays them, so it never reads the database
 * and shows nothing sensitive unless the app chose to write it.
 */
class WidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, build(context))
  }

  companion object {
    private const val PREFS = "exman_widget"

    fun save(context: Context, title: String, amount: String, sub: String) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("title", title).putString("amount", amount).putString("sub", sub).apply()
      refresh(context)
    }

    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, WidgetProvider::class.java))
      for (id in ids) manager.updateAppWidget(id, build(context))
    }

    private fun open(context: Context, uri: String, code: Int): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(context.packageName)
      return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun build(context: Context): RemoteViews {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val views = RemoteViews(context.packageName, R.layout.exman_widget)
      views.setTextViewText(R.id.widget_title, prefs.getString("title", "ExMan"))
      views.setTextViewText(R.id.widget_amount, prefs.getString("amount", "Open the app"))
      views.setTextViewText(R.id.widget_sub, prefs.getString("sub", ""))
      views.setOnClickPendingIntent(R.id.widget_root, open(context, "exman://", 1))
      views.setOnClickPendingIntent(R.id.widget_add, open(context, "exman://add", 2))
      return views
    }
  }
}
