package com.pokemon.idle;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PokeIdleBackground")
public class PokeIdleBackgroundPlugin extends Plugin {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4101;
    private static PokeIdleBackgroundPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!isSupportedPlatform()) {
            call.resolve(new JSObject().put("started", false));
            return;
        }

        boolean permissionRequested = false;
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                getActivity(),
                new String[] { Manifest.permission.POST_NOTIFICATIONS },
                NOTIFICATION_PERMISSION_REQUEST
            );
            permissionRequested = true;
        }

        Intent intent = new Intent(getContext(), PokeIdleBackgroundService.class)
            .setAction(PokeIdleBackgroundService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(getContext(), intent);
        } else {
            getContext().startService(intent);
        }

        call.resolve(new JSObject()
            .put("started", true)
            .put("notificationPermissionRequested", permissionRequested));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), PokeIdleBackgroundService.class)
            .setAction(PokeIdleBackgroundService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve(new JSObject().put("stopped", true));
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        call.resolve(new JSObject().put("supported", isSupportedPlatform()));
    }

    static void emitBackgroundTick(long now) {
        PokeIdleBackgroundPlugin plugin = instance;
        if (plugin == null) return;
        JSObject payload = new JSObject().put("now", now);
        plugin.notifyListeners("backgroundTick", payload);
    }

    private boolean isSupportedPlatform() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
    }
}
