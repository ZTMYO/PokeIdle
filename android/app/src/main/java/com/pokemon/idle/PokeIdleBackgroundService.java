package com.pokemon.idle;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class PokeIdleBackgroundService extends Service {
    public static final String ACTION_START = "com.pokemon.idle.action.START_BACKGROUND";
    public static final String ACTION_STOP = "com.pokemon.idle.action.STOP_BACKGROUND";

    private static final String CHANNEL_ID = "pokeidle_background";
    private static final int NOTIFICATION_ID = 4102;
    private static final long HEARTBEAT_MS = 15_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable heartbeat = new Runnable() {
        @Override
        public void run() {
            PokeIdleBackgroundPlugin.emitBackgroundTick(System.currentTimeMillis());
            handler.postDelayed(this, HEARTBEAT_MS);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        handler.post(heartbeat);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (ACTION_STOP.equals(intent != null ? intent.getAction() : null)) {
            if (intent != null && intent.getBooleanExtra(PokeIdleBackgroundPlugin.EXTRA_NOTIFY_STOPPED, false)) {
                PokeIdleBackgroundPlugin.emitBackgroundStopped();
            }
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(heartbeat);
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "后台挂机",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("口袋挂机后台自动遇敌与抓捕");
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent stopIntent = new Intent(this, PokeIdleBackgroundService.class)
            .setAction(ACTION_STOP)
            .putExtra(PokeIdleBackgroundPlugin.EXTRA_NOTIFY_STOPPED, true);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent stopPendingIntent = PendingIntent.getService(this, 4103, stopIntent, flags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("口袋挂机正在运行")
            .setContentText("后台自动遇敌与抓捕中")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "停止挂机", stopPendingIntent)
            .build();
    }
}
