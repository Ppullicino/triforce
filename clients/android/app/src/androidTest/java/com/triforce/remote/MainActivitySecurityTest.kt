package com.triforce.remote

import android.webkit.WebSettings
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivitySecurityTest {
    @Test
    fun webViewUsesHardenedSettingsAndPackagedHttpsOrigin() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val webView = activity.findViewById<android.view.ViewGroup>(android.R.id.content)
                    .findViewById<WebView>(android.R.id.content) ?: findWebView(activity.findViewById(android.R.id.content))
                assertTrue(webView.settings.javaScriptEnabled)
                assertTrue(webView.settings.domStorageEnabled)
                assertFalse(webView.settings.allowFileAccess)
                assertFalse(webView.settings.allowContentAccess)
                assertTrue(webView.settings.mixedContentMode == WebSettings.MIXED_CONTENT_NEVER_ALLOW)
                assertTrue(webView.url.orEmpty().startsWith("https://appassets.androidplatform.net/"))
            }
        }
    }

    private fun findWebView(view: android.view.View): WebView {
        if (view is WebView) return view
        val group = view as android.view.ViewGroup
        for (index in 0 until group.childCount) {
            try { return findWebView(group.getChildAt(index)) } catch (_: IllegalArgumentException) { }
        }
        throw IllegalArgumentException("WebView not found")
    }

    @Test
    fun credentialsRoundTripThroughAndroidKeystore() {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val vault = CredentialVault(context)
        vault.set("instrumented-host", "instrumented-secret")
        assertTrue(vault.get("instrumented-host") == "instrumented-secret")
        vault.delete("instrumented-host")
        assertTrue(vault.get("instrumented-host") == null)
    }
}
