package pk.movelab.kneequest;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The contract the web layer expects (see js/okc/sync.js):
 *   getContext()                    JSON about this app (role, debug flag, public site address)
 *   saveSession(json)               keep a copy of a finished game session in the phone's database
 *   setLang(lang)                   remember the language the user picked
 *   saveFile(name, mime, text)      hand a generated file (the researcher's CSV exports) to the share sheet
 *   shareText(title, text)          hand a short message (study ID + access code) to the share sheet
 * Everything here is reachable only from this app's own bundled pages (see MainActivity).
 */
public class AndroidBridge {
    private final Activity activity;
    private final LocalDb db;
    private final SharedPreferences prefs;

    AndroidBridge(Activity activity) {
        this.activity = activity;
        this.db = new LocalDb(activity);
        this.prefs = activity.getSharedPreferences("movelab", Activity.MODE_PRIVATE);
    }

    @JavascriptInterface
    public String getContext() {
        try {
            JSONObject o = new JSONObject();
            o.put("app", BuildConfig.ROLE);
            o.put("preview", BuildConfig.DEBUG);          // debug builds keep the mouse "preview" button for testing without a camera
            o.put("publicBase", BuildConfig.PUBLIC_BASE);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public boolean saveSession(String json) {
        try {
            JSONObject o = new JSONObject(json);
            db.put(o.getString("id"), o.optString("studyId", ""), json);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public void setLang(String lang) {
        prefs.edit().putString("lang", lang).apply();
    }

    @JavascriptInterface
    public void saveFile(String name, String mime, String text) {
        try {
            File dir = new File(activity.getCacheDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) return;
            File f = new File(dir, name.replaceAll("[^A-Za-z0-9._-]", "_"));
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF});   // UTF-8 BOM so Excel shows Urdu text correctly
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(activity, BuildConfig.APPLICATION_ID + ".files", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime == null || mime.isEmpty() ? "text/csv" : mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, f.getName());
            activity.runOnUiThread(() -> activity.startActivity(chooser));
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void shareText(String title, String text) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, title);
        send.putExtra(Intent.EXTRA_TEXT, text);
        Intent chooser = Intent.createChooser(send, title);
        activity.runOnUiThread(() -> activity.startActivity(chooser));
    }
}
