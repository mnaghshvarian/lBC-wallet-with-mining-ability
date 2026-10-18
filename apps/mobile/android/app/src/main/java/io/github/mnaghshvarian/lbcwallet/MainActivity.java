package io.github.mnaghshvarian.lbcwallet;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LbcNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Draw behind the system bars; the UI pads itself with the safe-area insets.
        EdgeToEdge.enable(this);
    }
}
