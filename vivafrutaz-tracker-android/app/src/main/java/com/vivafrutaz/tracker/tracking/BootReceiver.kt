package com.vivafrutaz.tracker.tracking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.vivafrutaz.tracker.data.SecureStore

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!SecureStore(context).hasSession()) return

        runCatching {
            ContextCompat.startForegroundService(
                context,
                Intent(context, TrackingService::class.java),
            )
        }
    }
}