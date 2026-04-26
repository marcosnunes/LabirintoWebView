package com.labirinto.webview;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.Log;
import java.util.Locale;

import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;

import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.PlayGamesSdk;
import com.labirinto.webview.databinding.ActivityMainBinding;

public class MainActivity extends AppCompatActivity {

    private static final String KEY_WEBVIEW_STATE = "WEBVIEW_STATE";
    private static final String ASSET_URL = "https://appassets.androidplatform.net/assets/www/index.html";

    private ActivityMainBinding binding;
    private OnBackPressedCallback backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        PlayGamesSdk.initialize(this);
        EdgeToEdge.enable(this);

        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        setupUI();
        setupWebView(savedInstanceState);
        setupBackNavigation();
        checkPlayGamesAuthentication();
    }

    private void setupUI() {
        binding.getRoot().setBackgroundColor(Color.TRANSPARENT);
        binding.webView.setBackgroundColor(Color.TRANSPARENT);
        binding.webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

        ViewCompat.setOnApplyWindowInsetsListener(binding.webView, (view, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            injectInsetsToJS(systemBars);
            return insets;
        });
        ViewCompat.requestApplyInsets(binding.webView);
    }

    private void injectInsetsToJS(Insets insets) {
        String js = String.format(
                Locale.US,
                "window.__ANDROID_INSETS__={top:%d,right:%d,bottom:%d,left:%d};" +
                        "window.dispatchEvent(new Event('androidInsetsChanged'));",
                insets.top, insets.right, insets.bottom, insets.left
        );
        binding.webView.evaluateJavascript(js, null);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView(Bundle savedInstanceState) {
        WebView webView = binding.webView;
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        // Security: Disable file access if using WebViewAssetLoader
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                updateBackNavigationState();
                // Re-aplica insets após a página estar pronta (UI-01: corrige race condition)
                ViewCompat.requestApplyInsets(webView);
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                super.doUpdateVisitedHistory(view, url, isReload);
                updateBackNavigationState();
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        if (savedInstanceState != null && savedInstanceState.containsKey(KEY_WEBVIEW_STATE)) {
            Bundle webViewBundle = savedInstanceState.getBundle(KEY_WEBVIEW_STATE);
            if (webViewBundle != null) {
                webView.restoreState(webViewBundle);
            }
        } else {
            webView.loadUrl(ASSET_URL);
        }
    }

    private void setupBackNavigation() {
        backCallback = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                if (isAuxiliaryRouteOpen() && binding.webView.canGoBack()) {
                    binding.webView.goBack();
                    return;
                }
                finish();
            }
        };
        getOnBackPressedDispatcher().addCallback(this, backCallback);
    }

    private boolean isAuxiliaryRouteOpen() {
        if (binding == null) {
            return false;
        }
        String url = binding.webView.getUrl();
        if (url == null) {
            return false;
        }
        return url.contains("#/ajuda") || url.contains("#/privacidade");
    }

    private void updateBackNavigationState() {
        if (backCallback != null && binding != null) {
            backCallback.setEnabled(binding.webView.canGoBack());
        }
    }

    private void checkPlayGamesAuthentication() {
        PlayGames.getGamesSignInClient(this).isAuthenticated().addOnCompleteListener(task -> {
            if (task.isSuccessful() && task.getResult().isAuthenticated()) {
                onPlayGamesAuthenticated();
            } else {
                attemptPlayGamesSignIn();
            }
        });
    }

    private void attemptPlayGamesSignIn() {
        PlayGames.getGamesSignInClient(this).signIn().addOnCompleteListener(task -> {
            if (task.isSuccessful() && task.getResult().isAuthenticated()) {
                onPlayGamesAuthenticated();
            } else {
                Log.w("PlayGames", "Auto sign-in failed or cancelled");
                notifyWebViewAuthStatus(false);
            }
        });
    }

    private void onPlayGamesAuthenticated() {
        Log.i("PlayGames", "User authenticated successfully");
        notifyWebViewAuthStatus(true);
    }

    private void notifyWebViewAuthStatus(boolean authenticated) {
        if (binding != null) {
            String js = String.format(Locale.US,
                "window.dispatchEvent(new CustomEvent('playGamesAuth', { detail: { authenticated: %b } }));",
                authenticated
            );
            binding.webView.evaluateJavascript(js, null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (binding != null) {
            binding.webView.onResume();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (binding != null) {
            binding.webView.onPause();
        }
    }

    @Override
    protected void onDestroy() {
        if (binding != null) {
            binding.webView.destroy();
        }
        binding = null;
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        if (binding != null) {
            Bundle webViewBundle = new Bundle();
            binding.webView.saveState(webViewBundle);
            outState.putBundle(KEY_WEBVIEW_STATE, webViewBundle);
        }
    }
}
