package pk.movelab.kneequest;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;

/**
 * Hosts the MoveLab web app (bundled in assets) in a WebView. The patient flavor opens participant.html
 * (sign-in → consent → games), the researcher flavor opens researcher.html (the dashboard).
 *
 * The files are served from https://appassets.androidplatform.net/assets/ so ES modules, getUserMedia and
 * Firebase all see a normal secure origin — nothing is read from file:// and no network is needed to load the UI.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String BASE = "https://" + HOST + "/assets/";
    private static final int REQ_CAMERA = 41;

    private WebView web;
    private PermissionRequest pendingCamera;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if ("patient".equals(BuildConfig.ROLE)) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // exercises run for minutes with no touches
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0A0E24);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0A0E24);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        // Android 15 draws apps edge-to-edge; keep the web content clear of the status/navigation bars.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            @SuppressWarnings("deprecation") int l = insets.getSystemWindowInsetLeft(), t = insets.getSystemWindowInsetTop(),
                    r = insets.getSystemWindowInsetRight(), b = insets.getSystemWindowInsetBottom();
            v.setPadding(l, t, r, b);
            return insets;
        });
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);   // chrome://inspect works on debug builds only

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;          // our own pages stay in the app
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}   // anything else opens in the browser
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> handlePermission(request));
            }
        });

        web.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(BASE + startPage());
        }
    }

    /** Start page: the flavor's page; debug builds may be pointed elsewhere with  --es page "okc.html?pid=P001&lang=ur". */
    private String startPage() {
        if (BuildConfig.DEBUG) {
            String p = getIntent().getStringExtra("page");
            if (p != null && p.matches("^[A-Za-z0-9_./?&=%#-]+$") && !p.contains("..") && !p.startsWith("/")) return p;
        }
        return BuildConfig.START_PAGE;
    }

    private void handlePermission(PermissionRequest request) {
        boolean ours = request.getOrigin() != null && HOST.equals(request.getOrigin().getHost());
        boolean wantsVideo = false;
        for (String r : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsVideo = true;
        if (!ours || !wantsVideo) { request.deny(); return; }       // the app only ever needs the camera, and only for its own pages
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            if (pendingCamera != null) pendingCamera.deny();
            pendingCamera = request;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != REQ_CAMERA || pendingCamera == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            pendingCamera.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            pendingCamera.deny();
        }
        pendingCamera = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }

    @Override
    protected void onDestroy() {
        ((FrameLayout) web.getParent()).removeView(web);
        web.destroy();
        super.onDestroy();
    }
}
