package io.github.mnaghshvarian.lbcwallet;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.os.PowerManager;
import android.util.Base64;
import android.view.WindowManager;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Native services for the wallet's web code: app-private file storage, plain and
 * TLS sockets (LBRY hubs speak newline-delimited JSON over TCP), and a few
 * system features (screenshot blocking, clipboard, sharing, links).
 */
@CapacitorPlugin(name = "LbcNative")
public class LbcNativePlugin extends Plugin {
    /** Document names: "settings.json", "wallets/<id>.lbcwallet.json" and their ".bak" copies. */
    private static final Pattern NAME = Pattern.compile("^[A-Za-z0-9_-][A-Za-z0-9._-]{0,120}(/[A-Za-z0-9_-][A-Za-z0-9._-]{0,120})?$");
    private static final Pattern HOST = Pattern.compile("^[A-Za-z0-9.:\\[\\]-]{1,253}$");
    private static final Pattern FILE_NAME = Pattern.compile("^[A-Za-z0-9._-]{1,100}$");
    private static final int MAX_LINE = 16 * 1024 * 1024;
    private static final long CLIPBOARD_CLEAR_MS = 30_000;

    private final ConcurrentHashMap<String, Connection> sockets = new ConcurrentHashMap<>();
    private final ExecutorService connector = Executors.newCachedThreadPool();
    private final Object fileLock = new Object();

    private File dataDir() {
        File dir = new File(getContext().getFilesDir(), "lbcwallet");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("cannot create " + dir);
        return dir;
    }

    private File document(String name) {
        if (name == null || !NAME.matcher(name).matches() || name.contains("..")) throw new IllegalArgumentException("invalid document name");
        return new File(dataDir(), name);
    }

    // ------------------------------------------------------------------ app

    @PluginMethod
    public void info(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("sdkInt", Build.VERSION.SDK_INT);
        r.put("release", Build.VERSION.RELEASE);
        String webView = "unknown";
        PackageInfo wv = WebViewCompat.getCurrentWebViewPackage(ctx);
        if (wv != null && wv.versionName != null) webView = wv.versionName;
        r.put("webView", webView);
        String version = "0";
        try {
            PackageInfo p = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            if (p.versionName != null) version = p.versionName;
        } catch (Exception ignored) {
            // keep "0"
        }
        r.put("versionName", version);
        r.put("dataDir", dataDir().getAbsolutePath());
        r.put("debug", (ctx.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        call.resolve(r);
    }

    @PluginMethod
    public void setSecure(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }

    // ------------------------------------------------------------------ mining

    /** Battery, temperature and battery saver, so mining can pause when the phone is unplugged, warm or saving power. */
    @PluginMethod
    public void powerState(PluginCall call) {
        Context ctx = getContext();
        // The battery broadcast is sticky: registering without a receiver returns the latest one.
        Intent battery = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        JSObject r = new JSObject();
        if (battery != null) {
            r.put("pluggedIn", battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0);
            int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            if (level >= 0 && scale > 0) r.put("level", (double) level / scale);
            // Tenths of a degree Celsius.
            int temperature = battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
            if (temperature != Integer.MIN_VALUE) r.put("temperature", temperature / 10.0);
        } else {
            r.put("pluggedIn", false);
        }
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        r.put("powerSave", pm != null && pm.isPowerSaveMode());
        r.put("thermal", pm != null && Build.VERSION.SDK_INT >= 29 ? pm.getCurrentThermalStatus() : 0);
        call.resolve(r);
    }

    /** Keeps the screen on while the phone mines (mining runs only while the app is on screen). */
    @PluginMethod
    public void keepScreenOn(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !url.toLowerCase().startsWith("https://")) {
            call.reject("Only https links can be opened");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app can open this link");
        }
    }

    @PluginMethod
    public void copy(PluginCall call) {
        final String text = call.getString("text", "");
        final boolean sensitive = Boolean.TRUE.equals(call.getBoolean("sensitive", false));
        new Handler(Looper.getMainLooper()).post(() -> {
            ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = ClipData.newPlainText("LBC Wallet", text);
            if (sensitive && Build.VERSION.SDK_INT >= 33) {
                PersistableBundle extras = new PersistableBundle();
                extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
                clip.getDescription().setExtras(extras);
            }
            cm.setPrimaryClip(clip);
            if (sensitive) {
                // Clear it later if it is still ours (readable only while the app is in front).
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    try {
                        ClipData current = cm.getPrimaryClip();
                        if (current != null && current.getItemCount() > 0 && text.contentEquals(current.getItemAt(0).coerceToText(getContext()))) {
                            if (Build.VERSION.SDK_INT >= 28) cm.clearPrimaryClip();
                            else cm.setPrimaryClip(ClipData.newPlainText("", ""));
                        }
                    } catch (Exception ignored) {
                        // the clipboard is not readable from the background
                    }
                }, CLIPBOARD_CLEAR_MS);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void paste(PluginCall call) {
        new Handler(Looper.getMainLooper()).post(() -> {
            ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            String text = "";
            ClipData clip = cm.getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) {
                CharSequence cs = clip.getItemAt(0).coerceToText(getContext());
                if (cs != null) text = cs.toString();
            }
            JSObject r = new JSObject();
            r.put("text", text);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void shareText(PluginCall call) {
        String filename = call.getString("filename", "export.txt");
        String mime = call.getString("mimeType", "text/plain");
        String title = call.getString("title", "");
        String text = call.getString("text", "");
        if (filename == null || !FILE_NAME.matcher(filename).matches()) {
            call.reject("invalid file name");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "exports");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create export folder");
            File file = new File(dir, filename);
            try (OutputStream out = new FileOutputStream(file)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "sharing failed");
        }
    }

    @PluginMethod
    public void exit(PluginCall call) {
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().finishAndRemoveTask());
    }

    // ------------------------------------------------------------------ files

    @PluginMethod
    public void loadFiles(PluginCall call) {
        try {
            JSObject files = new JSObject();
            synchronized (fileLock) {
                collect(dataDir(), "", files);
            }
            JSObject r = new JSObject();
            r.put("files", files);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("could not read the wallet files: " + e.getMessage());
        }
    }

    private void collect(File dir, String prefix, JSObject out) throws IOException {
        File[] entries = dir.listFiles();
        if (entries == null) return;
        for (File f : entries) {
            String name = prefix + f.getName();
            if (f.isDirectory()) {
                if (prefix.isEmpty()) collect(f, name + "/", out);
            } else if (f.getName().startsWith(".tmp-")) {
                // a write that never finished; the previous version is still in place
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            } else if (name.endsWith(".json") || name.endsWith(".json.bak")) {
                out.put(name, readText(f));
            }
        }
    }

    private static String readText(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream((int) Math.max(16, f.length()));
            byte[] chunk = new byte[16384];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            return buf.toString("UTF-8");
        }
    }

    /** Writes a temporary file, syncs it to disk and renames it over the old one. */
    @PluginMethod
    public void writeFile(PluginCall call) {
        try {
            File target = document(call.getString("name"));
            String content = call.getString("content", "");
            synchronized (fileLock) {
                File dir = target.getParentFile();
                if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create " + dir);
                File tmp = new File(dir, ".tmp-" + target.getName() + "-" + UUID.randomUUID());
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    out.write(content.getBytes(StandardCharsets.UTF_8));
                    out.flush();
                    out.getFD().sync();
                }
                if (!tmp.renameTo(target)) {
                    //noinspection ResultOfMethodCallIgnored
                    tmp.delete();
                    throw new IOException("could not replace " + target.getName());
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "write failed");
        }
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        try {
            File target = document(call.getString("name"));
            synchronized (fileLock) {
                if (target.exists() && !target.delete()) throw new IOException("could not delete " + target.getName());
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "delete failed");
        }
    }

    // ------------------------------------------------------------------ sockets

    @PluginMethod
    public void socketConnect(PluginCall call) {
        final String host = call.getString("host", "");
        final Integer port = call.getInt("port");
        final boolean tls = Boolean.TRUE.equals(call.getBoolean("tls", false));
        // Raw connections (WebSockets to the order board's relays) report bytes, not lines.
        final boolean rawBytes = Boolean.TRUE.equals(call.getBoolean("raw", false));
        final int timeout = Math.max(1000, Math.min(60_000, call.getInt("timeoutMs", 15_000)));
        if (host == null || !HOST.matcher(host).matches() || port == null || port < 1 || port > 65535) {
            call.reject("invalid server address");
            return;
        }
        connector.execute(() -> {
            Socket socket = null;
            try {
                Socket raw = new Socket();
                socket = raw;
                raw.connect(new InetSocketAddress(host, port), timeout);
                raw.setTcpNoDelay(true);
                raw.setKeepAlive(true);
                if (tls) {
                    SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
                    SSLSocket ssl = (SSLSocket) factory.createSocket(raw, host, port, true);
                    socket = ssl;
                    // Check the certificate's host name too, not only its chain.
                    SSLParameters params = ssl.getSSLParameters();
                    params.setEndpointIdentificationAlgorithm("HTTPS");
                    ssl.setSSLParameters(params);
                    ssl.setSoTimeout(timeout);
                    ssl.startHandshake();
                }
                socket.setSoTimeout(0);
                String id = UUID.randomUUID().toString();
                Connection c = new Connection(id, socket, rawBytes);
                sockets.put(id, c);
                JSObject r = new JSObject();
                r.put("id", id);
                call.resolve(r);
                c.start();
            } catch (Exception e) {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (IOException ignored) {
                        // already failing
                    }
                }
                call.reject(describe(e));
            }
        });
    }

    @PluginMethod
    public void socketWrite(PluginCall call) {
        Connection c = sockets.get(call.getString("id", ""));
        if (c == null) {
            call.reject("socket closed");
            return;
        }
        String data = call.getString("data", "");
        byte[] bytes;
        if (Boolean.TRUE.equals(call.getBoolean("base64", false))) {
            try {
                bytes = Base64.decode(data, Base64.NO_WRAP);
            } catch (IllegalArgumentException e) {
                call.reject("invalid base64");
                return;
            }
        } else {
            bytes = data.getBytes(StandardCharsets.UTF_8);
        }
        c.write(bytes, call);
    }

    @PluginMethod
    public void socketClose(PluginCall call) {
        Connection c = sockets.remove(call.getString("id", ""));
        if (c != null) c.close(null, false);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (Connection c : sockets.values()) c.close(null, false);
        sockets.clear();
        connector.shutdownNow();
        super.handleOnDestroy();
    }

    private static String describe(Exception e) {
        String type = e.getClass().getSimpleName();
        String msg = e.getMessage();
        if (e instanceof java.net.ConnectException) return "ECONNREFUSED " + (msg != null ? msg : "");
        if (e instanceof java.net.UnknownHostException) return "ENOTFOUND " + (msg != null ? msg : "");
        if (e instanceof java.net.SocketTimeoutException) return "timed out";
        return msg != null ? type + ": " + msg : type;
    }

    /** One connection: a reader thread that reports lines (or raw chunks), and an ordered writer. */
    private final class Connection {
        final String id;
        final Socket socket;
        final boolean raw;
        final ExecutorService writer = Executors.newSingleThreadExecutor();
        volatile boolean closed = false;

        Connection(String id, Socket socket, boolean raw) {
            this.id = id;
            this.socket = socket;
            this.raw = raw;
        }

        void start() {
            Thread t = new Thread(this::readLoop, "lbc-socket-" + id.substring(0, 8));
            t.setDaemon(true);
            t.start();
        }

        void write(byte[] data, PluginCall call) {
            writer.execute(() -> {
                try {
                    OutputStream out = socket.getOutputStream();
                    out.write(data);
                    out.flush();
                    call.resolve();
                } catch (Exception e) {
                    call.reject(describe(e));
                    close(describe(e), true);
                }
            });
        }

        private void readLoop() {
            String error = null;
            try {
                InputStream in = socket.getInputStream();
                ByteArrayOutputStream line = new ByteArrayOutputStream(4096);
                byte[] buf = new byte[65536];
                int n;
                while (!closed && (n = in.read(buf)) > 0) {
                    if (raw) {
                        emitData(Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
                        continue;
                    }
                    int start = 0;
                    for (int i = 0; i < n; i++) {
                        if (buf[i] != '\n') continue;
                        line.write(buf, start, i - start);
                        emit(line.toString("UTF-8"));
                        line.reset();
                        start = i + 1;
                    }
                    line.write(buf, start, n - start);
                    if (line.size() > MAX_LINE) throw new IOException("line too long");
                }
            } catch (Exception e) {
                if (!closed) error = describe(e);
            }
            close(error, true);
        }

        private void emitData(String base64) {
            JSObject e = new JSObject();
            e.put("id", id);
            e.put("type", "data");
            e.put("data", base64);
            notifyListeners("socket", e);
        }

        private void emit(String text) {
            String l = text.endsWith("\r") ? text.substring(0, text.length() - 1) : text;
            if (l.trim().isEmpty()) return;
            JSObject e = new JSObject();
            e.put("id", id);
            e.put("type", "line");
            e.put("line", l);
            notifyListeners("socket", e);
        }

        void close(String error, boolean notify) {
            if (closed) return;
            closed = true;
            sockets.remove(id);
            try {
                socket.close();
            } catch (IOException ignored) {
                // closing anyway
            }
            writer.shutdown();
            if (notify) {
                JSObject e = new JSObject();
                e.put("id", id);
                e.put("type", "close");
                if (error != null) e.put("error", error);
                notifyListeners("socket", e);
            }
        }
    }
}
