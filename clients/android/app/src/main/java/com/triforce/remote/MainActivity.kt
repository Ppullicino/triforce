package com.triforce.remote

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var errorView: TextView
    private val appOrigin = Uri.parse("https://appassets.androidplatform.net")

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        webView = WebView(this)
        errorView = TextView(this).apply {
            setBackgroundColor(Color.rgb(9, 13, 24)); setTextColor(Color.WHITE)
            textSize = 18f; setPadding(48, 80, 48, 48); visibility = TextView.GONE
            setOnClickListener { visibility = TextView.GONE; webView.reload() }
        }
        root.addView(webView, FrameLayout.LayoutParams(-1, -1)); root.addView(errorView, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        WebViewCompat.startSafeBrowsing(this, null)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            installCredentialBridge(CredentialVault(this))
        } else {
            showError("Android System WebView is out of date. Update it to enable secure credential storage, then tap to retry.")
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) = assetLoader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.scheme == "https" && request.url.host == appOrigin.host) return false
                if (request.url.scheme in setOf("http", "https")) startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel(); showError("Secure connection failed. Certificate errors are never bypassed. Tap to retry.")
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showError("Triforce could not load. Check the connection and tap to retry.")
            }
        }
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (webView.canGoBack()) webView.goBack() else finish() }
        })
    }

    private fun installCredentialBridge(vault: CredentialVault) {
        WebViewCompat.addWebMessageListener(webView, "triforceNative", setOf(appOrigin.toString())) { _, message, sourceOrigin, isMainFrame, reply ->
            if (!isMainFrame || sourceOrigin != appOrigin) return@addWebMessageListener
            val response = JSONObject()
            try {
                val request = JSONObject(message.data ?: "{}")
                response.put("id", request.getString("id"))
                val hostId = request.getString("hostId")
                when (request.getString("operation")) {
                    "get" -> response.put("value", vault.get(hostId))
                    "set" -> { vault.set(hostId, request.getString("token")); response.put("value", JSONObject.NULL) }
                    "delete" -> { vault.delete(hostId); response.put("value", JSONObject.NULL) }
                    else -> error("unsupported credential operation")
                }
            } catch (error: Exception) { response.put("error", error.message ?: "credential operation failed") }
            reply.postMessage(response.toString())
        }
    }

    private fun showError(message: String) { errorView.text = message; errorView.visibility = TextView.VISIBLE }

    override fun onDestroy() {
        webView.apply { stopLoading(); loadUrl("about:blank"); clearHistory(); removeAllViews(); destroy() }
        super.onDestroy()
    }
}
