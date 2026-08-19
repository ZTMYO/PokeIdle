package com.pokemon.idle;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PokeIdleBackgroundPlugin.class);
        super.onCreate(savedInstanceState);
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
