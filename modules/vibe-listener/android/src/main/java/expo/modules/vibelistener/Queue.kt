package expo.modules.vibelistener

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// Receivers run even when the app process is dead, so raw messages land in a SharedPreferences
// queue that JS drains (and parses) on next launch. Parsing stays in one place: src/utils/parser.ts.
object Queue {
  private const val PREFS = "vibe_queue"
  private const val KEY = "items"

  @Synchronized
  fun push(ctx: Context, kind: String, sender: String, text: String, ts: Long) {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val items = JSONArray(prefs.getString(KEY, "[]"))
    items.put(JSONObject().put("kind", kind).put("sender", sender).put("text", text).put("ts", ts))
    prefs.edit().putString(KEY, items.toString()).apply()
    VibeListenerModule.instance?.emitRaw()
  }

  @Synchronized
  fun drain(ctx: Context): List<String> {
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val items = JSONArray(prefs.getString(KEY, "[]"))
    prefs.edit().remove(KEY).commit()
    return List(items.length()) { items.getJSONObject(it).toString() }
  }
}
