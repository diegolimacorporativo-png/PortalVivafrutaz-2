package com.vivafrutaz.tracker.data

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

class SessionCookieJar(private val store: SecureStore) : CookieJar {
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val raw = store.sessionCookie() ?: return emptyList()
        val cookie = Cookie.parse(url, raw) ?: return emptyList()
        if (cookie.expiresAt < System.currentTimeMillis()) {
            store.clearSession()
            return emptyList()
        }
        return if (cookie.matches(url)) listOf(cookie) else emptyList()
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        cookies.firstOrNull { it.name == "sessionId" }?.let {
            store.saveSessionCookie(it.toString())
        }
    }
}