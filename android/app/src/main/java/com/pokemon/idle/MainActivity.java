package com.pokemon.idle;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // WebView 默认要求先有用户手势才允许播放音频：关掉它，切后台回来也能接着放 BGM
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
