// QingYaoTP AILauncher（本地 AI）—— 便携版启动器
//
// 职责：
//   1. 用随包的 node.exe 启动 app.mjs（工作目录 app\），日志落到 logs\app.log
//   2. 服务端口就绪后用 WebView2 打开内嵌窗口（缺运行时/初始化失败则静默回退浏览器）
//   3. 托盘常驻：右键可「打开界面 / 停止服务并退出 / 退出启动器」
//   4. 停止服务走 /api/state 取本地令牌再 POST /api/shutdown —— 优雅退出，
//      而不是像 .bat 那样只能强杀进程
//   5. 单实例：再次双击交给已在运行的实例开窗（命名管道），不会起第二个窗口/第二个服务
//
// 编译：
//   csc /target:winexe /win32icon:localai.ico /r:System.Windows.Forms.dll /r:System.Drawing.dll
//       /r:webview2\Microsoft.Web.WebView2.Core.dll /r:webview2\Microsoft.Web.WebView2.WinForms.dll
//
// 命令行：
//   （无参数）        启动服务 + 打开界面 + 托盘
//   --start-hidden   启动服务 + 托盘，不打开界面
//   --stop           优雅停止服务（必要时按 pid 兜底强杀）
//   --status         服务在跑则退出码 0，否则 1
//   --no-webview     不用内嵌窗口，改用浏览器 --app 窗口

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

static class Launcher
{
    // 主品牌 QingYaoTP AILauncher（QingYaoTP = QingYaoTestifypred），副标题「本地 AI」保留
    internal const string BrandName = "QingYaoTP AILauncher";
    internal const string SubName = "本地 AI";
    internal const string AppName = BrandName + "（" + SubName + "）";
    const string MutexName = "QingYaoTP.AILauncher.Portable.Launcher";
    const string PipeName = "QingYaoTP.AILauncher.Portable.OpenUi";

    static string Root;      // exe 所在目录
    static string AppDir;    // Root\app
    static string NodeExe;
    static string LogDir;
    static string ConfigPath;
    static int Port = 8099;
    static string ModelDir = "";
    static string AutoLoad = "";
    static int ContextSize = 16384;
    static bool KvReuse = true;
    static string Gpu = "auto";      // auto / vulkan / cpu
    static bool UseWebView = true;   // 用内嵌窗口；--no-webview 可强制回浏览器

    static Process Server;
    static NotifyIcon Tray;
    static Form UiForm;
    static Microsoft.Web.WebView2.WinForms.WebView2 WebView;
    static Control UiMarshal;   // 跨线程投递「开窗」指令用的中转控件
    static float UiScale = 1f;  // 系统缩放比例（175% 屏 = 1.75）
    static volatile bool Stopping;   // 正在主动停机（不触发守护重启）
    static volatile bool Ready;
    static int RestartCount;
    static DateTime LastRestartAt = DateTime.MinValue;
    static volatile bool StartFailed;
    static string StartError = "";

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Root = Path.GetDirectoryName(Application.ExecutablePath);
        AppDir = Path.Combine(Root, "app");
        LogDir = Path.Combine(Root, "logs");
        ConfigPath = Path.Combine(Root, "config.ini");
        LoadConfig();
        Directory.CreateDirectory(LogDir);

        // 取系统缩放比例。清单已声明 DPI 感知，这里按比例把界面尺寸折算成真实像素，
        // 否则在 175% 屏上窗口要么被系统拉伸（糊），要么显得特别小。
        try
        {
            using (var g = Graphics.FromHwnd(IntPtr.Zero)) UiScale = g.DpiX / 96f;
        }
        catch { UiScale = 1f; }
        if (UiScale < 1f) UiScale = 1f;

        string mode = args.Length > 0 ? args[0].ToLowerInvariant() : "";
        foreach (var a in args) if (a.ToLowerInvariant() == "--no-webview") UseWebView = false;

        if (mode == "--status")
            return Ping() ? 0 : 1;

        if (mode == "--stop")
            return StopService() ? 0 : 2;

        // 单实例：已经在跑就让它把窗口叫回来
        bool isFirst;
        using (var mutex = new Mutex(true, MutexName, out isFirst))
        {
            if (!isFirst)
            {
                if (mode == "--start-hidden") return 0;
                // 再次双击图标：服务在跑就只开窗；服务被停了就让它顺手把服务拉起来
                if (SignalExisting((byte)(Ping() ? 1 : 2))) return 0;
                if (Ping()) OpenInBrowser(); // 常驻实例没了但服务还在，退回浏览器
                else MessageBox.Show("启动器已经在运行（请看托盘图标）。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }

            if (!Ping())
            {
                // 先自检再启动：端口被占自动换、缺运行库先装，别让用户去猜日志
                EnsurePortFree();
                WarnLowDisk();
                if (!CheckRuntime()) return 3;
                if (!LaunchNode()) return 1;
                if (!WaitForService()) return 1;
            }

            UiMarshal = new Control();
            var forceHandle = UiMarshal.Handle; // 跨线程 BeginInvoke 必须有句柄
            StartOpenPipe();

            SetupTray();
            if (mode != "--start-hidden") OpenUi();
            Application.Run(); // 托盘消息循环（关掉界面窗口不会退出）
            CloseUi();
            HideTray();
            return 0;
        }
    }

    // ---------------------------------------------------------------- 配置
    // ---------------------------------------------------------------- 环境自检
    // 全新 Windows 上最常见的两个坑：没有 VC++ 运行库（模型根本加载不了）、
    // 端口被别的软件占着（服务起不来，界面白屏）。这里都在拉起 node 之前处理掉。

    static bool PortFree(int p)
    {
        try
        {
            var l = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, p);
            l.Start();
            l.Stop();
            return true;
        }
        catch { return false; }
    }

    /** 端口被占就往后找，并写回 config.ini，让下次启动也记得 */
    static void EnsurePortFree()
    {
        if (PortFree(Port)) return;
        int picked = 0;
        for (int p = 8091; p <= 8110; p++)
        {
            if (PortFree(p)) { picked = p; break; }
        }
        if (picked == 0)
        {
            Log("端口 " + Port + " 被占用，且 8091-8110 都不可用，仍然尝试启动");
            return;
        }
        Log("端口 " + Port + " 被占用，改用 " + picked + " 并写回 config.ini");
        Port = picked;
        SavePortToConfig(picked);
    }

    static void SavePortToConfig(int p)
    {
        try
        {
            var lines = new List<string>(File.Exists(ConfigPath) ? File.ReadAllLines(ConfigPath) : new string[0]);
            bool found = false;
            for (int i = 0; i < lines.Count; i++)
            {
                if (lines[i].TrimStart().StartsWith("port=")) { lines[i] = "port=" + p; found = true; break; }
            }
            if (!found) lines.Add("port=" + p);
            File.WriteAllLines(ConfigPath, lines.ToArray(), new UTF8Encoding(true));
        }
        catch (Exception ex) { Log("写回端口失败: " + ex.Message); }
    }

    static bool HasMsvcp()
    {
        try { return File.Exists(Path.Combine(Environment.SystemDirectory, "msvcp140.dll")); }
        catch { return false; }
    }

    /** 缺 VC++ 就引导安装；装不上就不硬启动（否则必然崩，用户只会看到一串看不懂的错误） */
    static bool CheckRuntime()
    {
        if (HasMsvcp()) return true;

        var bundled = Path.Combine(Root, "vc_redist.x64.exe");
        string msg = "这台电脑缺少 Microsoft VC++ 运行库（msvcp140.dll）。\n\n" +
                     "本地模型的原生组件依赖它，缺了会直接崩溃。\n\n" +
                     "现在安装吗？（约 25MB，装完无需重启）";
        var r = MessageBox.Show(msg, AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
        if (r != DialogResult.Yes) return false;

        try
        {
            if (File.Exists(bundled))
            {
                var psi = new ProcessStartInfo(bundled) { UseShellExecute = true };
                var pr = Process.Start(psi);
                if (pr != null) pr.WaitForExit();
            }
            else
            {
                Process.Start(new ProcessStartInfo("https://aka.ms/vs/17/release/vc_redist.x64.exe") { UseShellExecute = true });
                MessageBox.Show("请在浏览器里下好安装包，装完再双击启动。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return false;
            }
        }
        catch (Exception ex)
        {
            Log("启动 VC++ 安装失败: " + ex.Message);
        }

        if (HasMsvcp()) { Log("VC++ 运行库已就绪"); return true; }
        MessageBox.Show("仍然没有检测到 VC++ 运行库。装完安装包后重新双击启动即可。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
        return false;
    }

    static void WarnLowDisk()
    {
        try
        {
            var di = new DriveInfo(Root);
            if (di.AvailableFreeSpace < 2L * 1024 * 1024 * 1024)
            {
                Log("磁盘剩余不足 2GB: " + (di.AvailableFreeSpace / 1024 / 1024) + "MB");
                MessageBox.Show("安装目录所在磁盘剩余不足 2GB，下载模型可能会失败。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
        catch { }
    }

    static void LoadConfig()
    {
        var defaults = new Dictionary<string, string>();
        defaults["port"] = "8099";
        defaults["modelDir"] = "";          // 留空 = 用 exe 同级的 models 目录
        defaults["autoLoad"] = "";
        defaults["contextSize"] = "16384";
        defaults["kvReuse"] = "1";
        defaults["gpu"] = "auto";

        if (File.Exists(ConfigPath))
        {
            foreach (var raw in File.ReadAllLines(ConfigPath))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#") || line.StartsWith(";")) continue;
                var eq = line.IndexOf('=');
                if (eq <= 0) continue;
                var k = line.Substring(0, eq).Trim();
                var v = line.Substring(eq + 1).Trim();
                if (v.Length >= 2 && v[0] == '"' && v[v.Length - 1] == '"') v = v.Substring(1, v.Length - 2);
                defaults[k] = v;
            }
        }

        int p;
        if (int.TryParse(defaults["port"], out p) && p > 0 && p < 65536) Port = p;
        int c;
        if (int.TryParse(defaults["contextSize"], out c) && c >= 512) ContextSize = c;
        KvReuse = defaults["kvReuse"] != "0";
        AutoLoad = defaults["autoLoad"];
        ModelDir = defaults["modelDir"];
        if (ModelDir.Length == 0) ModelDir = Path.Combine(Root, "models");
        Gpu = defaults["gpu"].ToLowerInvariant();
        if (Gpu != "vulkan" && Gpu != "cpu") Gpu = "auto";
    }

    static string BaseUrl { get { return "http://127.0.0.1:" + Port; } }

    // ---------------------------------------------------------------- 启动服务
    static bool LaunchNode()
    {
        NodeExe = Path.Combine(Root, "runtime", "node.exe");
        if (!File.Exists(NodeExe)) NodeExe = "node"; // 退回系统 PATH

        var entry = Path.Combine(AppDir, "app.mjs");
        if (!File.Exists(entry))
        {
            MessageBox.Show("找不到 app\\app.mjs，便携目录不完整。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }

        var psi = new ProcessStartInfo();
        psi.FileName = NodeExe;
        psi.Arguments = "\"" + entry + "\"";
        psi.WorkingDirectory = AppDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        psi.EnvironmentVariables["MODEL_DIR"] = ModelDir;
        psi.EnvironmentVariables["PORT"] = Port.ToString();
        psi.EnvironmentVariables["CONTEXT_SIZE"] = ContextSize.ToString();
        psi.EnvironmentVariables["KV_REUSE"] = KvReuse ? "1" : "0";
        psi.EnvironmentVariables["LOCALAI_GPU"] = Gpu;
        if (AutoLoad.Length > 0) psi.EnvironmentVariables["AUTO_LOAD"] = AutoLoad;

        var logPath = Path.Combine(LogDir, "app.log");
        try
        {
            // 日志超过 20MB 就轮转一份，别让它无限长
            if (File.Exists(logPath) && new FileInfo(logPath).Length > 20 * 1024 * 1024)
                File.Move(logPath, logPath + ".1");
        }
        catch { }

        var log = new FileStream(logPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
        var writer = new StreamWriter(log, new UTF8Encoding(false));
        writer.AutoFlush = true;
        var gate = new object();
        Action<string> write = delegate(string s)
        {
            try { lock (gate) writer.WriteLine(s); } catch { }
        };

        try
        {
            Server = Process.Start(psi);
        }
        catch (Exception ex)
        {
            writer.Close();
            MessageBox.Show("无法启动 node.exe：" + ex.Message + "\n\n请确认 runtime\\node.exe 存在。", AppName,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }

        // 守护：node 进程意外退出（比如 Vulkan 设备丢失后主动退出重启）就拉起来
        Server.EnableRaisingEvents = true;
        Server.Exited += delegate(object s, EventArgs e)
        {
            if (Stopping) return;
            int code = 0;
            try { code = Server.ExitCode; } catch { }
            // 退出码 0 = 正常停机（--stop / 托盘「停止服务」/ 界面「退出服务」），不要再拉起来
            if (code == 0) return;
            Log("服务进程异常退出（退出码 " + code + "），准备重启");
            if (DateTime.Now - LastRestartAt < TimeSpan.FromSeconds(5)) return; // 防抖
            LastRestartAt = DateTime.Now;
            if (++RestartCount > 10)
            {
                Log("重启次数过多，停止守护");
                return;
            }
            Thread.Sleep(400);
            try
            {
                if (Stopping) return;
                if (!LaunchNode()) return;
                WaitForServiceQuiet();
                Log("服务已自动重启（第 " + RestartCount + " 次）");
            }
            catch (Exception ex)
            {
                Log("自动重启失败：" + ex.Message);
            }
        };

        // 两个流各用一个线程抽干，避免管道写满把 node 卡死
        PumpAsync(Server.StandardOutput, write);
        PumpAsync(Server.StandardError, write);
        write("===== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " 启动 =====");
        return true;
    }

    static void PumpAsync(StreamReader reader, Action<string> write)
    {
        var t = new Thread(delegate()
        {
            try
            {
                string line;
                while ((line = reader.ReadLine()) != null) write(line);
            }
            catch { }
        });
        t.IsBackground = true;
        t.Start();
    }

    /// <summary>重启后静默等待服务就绪（不开等待小窗）</summary>
    static bool WaitForServiceQuiet()
    {
        for (int i = 0; i < 240; i++)
        {
            if (Ping()) return true;
            try { if (Server != null && Server.HasExited) return false; } catch { }
            Thread.Sleep(500);
        }
        return false;
    }
    static bool WaitForService()
    {
        var splash = new SplashForm(UiScale);
        Ready = false;
        StartFailed = false;
        StartError = "";

        var poll = new Thread(delegate()
        {
            for (int i = 0; i < 480; i++) // 最多 240 秒
            {
                if (Ping())
                {
                    Ready = true;
                    break;
                }
                if (Server != null)
                {
                    try
                    {
                        if (Server.HasExited) { StartError = "服务进程已退出（退出码 " + Server.ExitCode + "）"; break; }
                    }
                    catch { }
                }
                Thread.Sleep(500);
                var msg = "正在启动模型服务… " + (i / 2) + " 秒";
                try { splash.BeginInvoke(new Action(delegate { splash.SetStatus(msg); })); } catch { }
            }
            StartFailed = !Ready;
            try { splash.BeginInvoke(new Action(delegate { splash.Close(); })); } catch { }
        });
        poll.IsBackground = true;
        poll.Start();

        Application.Run(splash);

        if (!Ready)
        {
            MessageBox.Show(
                (StartError.Length > 0 ? StartError : "服务没能在 240 秒内就绪。") +
                "\n\n日志：" + Path.Combine(LogDir, "app.log"),
                AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }
        return true;
    }

    // ---------------------------------------------------------------- 停机
    static bool StopService()
    {
        Stopping = true;
        if (!Ping()) return true;

        var token = JsonString(HttpGetSafe(BaseUrl + "/api/state", 2000), "localToken");
        if (token != null)
        {
            var headers = new Dictionary<string, string>();
            headers["x-local-token"] = token;
            HttpPostSafe(BaseUrl + "/api/shutdown", "{}", headers, 4000);
        }

        for (int i = 0; i < 20; i++) // 最多等 5 秒
        {
            if (!Ping()) return true;
            Thread.Sleep(250);
        }

        // 兜底：按 server.pid 强杀（优雅退出被卡住时才会走到这里）
        var pidFile = Path.Combine(AppDir, "server.pid");
        try
        {
            if (File.Exists(pidFile))
            {
                int pid;
                if (int.TryParse(File.ReadAllText(pidFile).Trim(), out pid))
                {
                    var p = Process.GetProcessById(pid);
                    p.Kill();
                    p.WaitForExit(3000);
                    return !Ping();
                }
            }
        }
        catch { }
        return !Ping();
    }

    // ---------------------------------------------------------------- 界面
    static string FindEdge()
    {
        var candidates = new string[]
        {
            @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        };
        foreach (var c in candidates) if (File.Exists(c)) return c;
        try
        {
            using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                if (key != null)
                {
                    var v = key.GetValue(null) as string;
                    if (v != null && File.Exists(v)) return v;
                }
        }
        catch { }
        return null;
    }

    // ---------------------------------------------------------------- 界面窗口
    // 首选：WebView2 内嵌窗口（系统自带 Chromium 运行时，不需要 Edge 浏览器本体）
    // 回退：Edge/Chrome 的 --app 模式，再不行就默认浏览器。全程静默，不弹错误框。

    /// <summary>WebView2 运行时是否已安装（HKLM 32/64 位与 HKCU 三处都查）。</summary>
    static bool WebViewRuntimeInstalled()
    {
        const string guid = @"{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
        var hives = new RegistryKey[] { Registry.LocalMachine, Registry.CurrentUser };
        var subs = new string[]
        {
            @"SOFTWARE\Microsoft\EdgeUpdate\Clients\" + guid,
            @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\" + guid,
        };
        foreach (var hive in hives)
        {
            foreach (var sub in subs)
            {
                try
                {
                    using (var k = hive.OpenSubKey(sub))
                    {
                        if (k == null) continue;
                        var v = k.GetValue("pv") as string;
                        if (!string.IsNullOrEmpty(v) && v != "0.0.0.0") return true;
                    }
                }
                catch { }
            }
        }
        return false;
    }

    static void OpenUi()
    {
        if (!UseWebView || !WebViewRuntimeInstalled())
        {
            Log("未启用内嵌窗口（UseWebView=" + UseWebView + "，运行时=" + WebViewRuntimeInstalled() + "），回退浏览器");
            OpenInBrowser();
            return;
        }

        try
        {
            if (UiForm != null && !UiForm.IsDisposed)
            {
                if (UiForm.WindowState == FormWindowState.Minimized) UiForm.WindowState = FormWindowState.Normal;
                UiForm.Activate();
                return;
            }

            var form = new Form();
            form.AutoScaleMode = AutoScaleMode.None; // 尺寸下面自己按 DPI 算，避免二次缩放
            form.Text = AppName;
            form.StartPosition = FormStartPosition.CenterScreen;
            var wa = Screen.PrimaryScreen.WorkingArea;
            var wantW = (int)(1120 * UiScale);
            var wantH = (int)(820 * UiScale);
            form.ClientSize = new Size(
                Math.Min(wantW, wa.Width - (int)(40 * UiScale)),
                Math.Min(wantH, wa.Height - (int)(60 * UiScale)));
            form.MinimumSize = new Size((int)(880 * UiScale), (int)(620 * UiScale));
            try { form.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { }

            var wv = new Microsoft.Web.WebView2.WinForms.WebView2();
            wv.Dock = DockStyle.Fill;
            // 用户数据（缓存、localStorage）放便携目录里，删掉即可重置
            var props = new Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties();
            props.UserDataFolder = Path.Combine(Root, "data", "webview2");
            wv.CreationProperties = props;

            wv.CoreWebView2InitializationCompleted += delegate(object s, CoreWebView2InitializationCompletedEventArgs e)
            {
                if (e.IsSuccess) return;
                var why = e.InitializationException != null ? e.InitializationException.Message : "未知原因";
                Log("WebView2 初始化失败：" + why + "，回退浏览器");
                try { form.Close(); } catch { }
                OpenInBrowser();
            };

            form.Controls.Add(wv);
            form.Show();
            // 偶尔窗口会以最小化状态出现（任务栏只剩图标），这里强制成正常显示
            if (form.WindowState != FormWindowState.Normal) form.WindowState = FormWindowState.Normal;
            form.Activate();
            wv.Source = new Uri(BaseUrl + "/");
            UiForm = form;
            WebView = wv;
            Log("已用 WebView2 打开内嵌窗口（" + form.ClientSize.Width + "x" + form.ClientSize.Height +
                "，缩放 " + UiScale.ToString("0.00") + "，状态 " + form.WindowState + "）");
        }
        catch (Exception ex)
        {
            Log("WebView2 启动异常：" + ex.Message + "，回退浏览器");
            OpenInBrowser();
        }
    }

    /// <summary>关掉内嵌窗口并释放浏览器子进程（退出启动器或服务停止时调用）。</summary>
    static void CloseUi()
    {
        try
        {
            if (UiForm != null && !UiForm.IsDisposed) UiForm.Close();
        }
        catch { }
        try
        {
            if (WebView != null) { WebView.Dispose(); WebView = null; }
        }
        catch { }
        UiForm = null;
    }

    /// <summary>回退路径：Edge/Chrome 的 --app 窗口，再不行就交给默认浏览器。</summary>
    static void OpenInBrowser()
    {
        var url = BaseUrl + "/";
        var exe = FindEdge();
        try
        {
            if (exe != null)
            {
                var psi = new ProcessStartInfo(exe, "--app=" + url + " --window-size=1120,820");
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            else
            {
                Process.Start(url);
            }
        }
        catch (Exception ex)
        {
            Log("打开浏览器失败：" + ex.Message);
        }
    }

    static void Log(string msg)
    {
        try
        {
            Directory.CreateDirectory(LogDir);
            File.AppendAllText(Path.Combine(LogDir, "launcher.log"),
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + "\r\n", new UTF8Encoding(false));
        }
        catch { }
    }

    // ---------------------------------------------------------------- 单实例协作
    /// <summary>常驻实例在后台监听管道；第二个实例连上来就让它把界面窗口叫回来。</summary>
    static void StartOpenPipe()
    {
        var t = new Thread(delegate()
        {
            while (true)
            {
                try
                {
                    using (var srv = new NamedPipeServerStream(PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte))
                    {
                        srv.WaitForConnection();
                        int cmd = srv.ReadByte();
                        var target = UiMarshal;
                        if (target == null) continue;
                        if (cmd == 2)
                        {
                            // 服务被停掉后又双击了图标：先把服务拉起来，再开窗口
                            var restartThread = new Thread(delegate()
                            {
                                try
                                {
                                    if (!Ping() && LaunchNode())
                                    {
                                        WaitForServiceQuiet();
                                        Log("按第二次启动请求，服务已重新启动");
                                    }
                                }
                                catch (Exception ex) { Log("按请求启动服务失败：" + ex.Message); }
                                try { target.BeginInvoke(new Action(OpenUi)); } catch { }
                            });
                            restartThread.IsBackground = true;
                            restartThread.Start();
                        }
                        else
                        {
                            target.BeginInvoke(new Action(OpenUi));
                        }
                    }
                }
                catch
                {
                    Thread.Sleep(500); // 管道被占用/瞬间出错，歇一下再来
                }
            }
        });
        t.IsBackground = true;
        t.Start();
    }

    /// <summary>尝试通知已在运行的实例开窗；返回 false 说明没有常驻实例在听。</summary>
    static bool SignalExisting(byte cmd)
    {
        try
        {
            using (var cli = new NamedPipeClientStream(".", PipeName, PipeDirection.Out))
            {
                cli.Connect(700);
                cli.WriteByte(cmd);
                cli.Flush();
                return true;
            }
        }
        catch { return false; }
    }

    // ---------------------------------------------------------------- 托盘
    static void SetupTray()
    {
        Tray = new NotifyIcon();
        try { Tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
        catch { Tray.Icon = SystemIcons.Application; }
        Tray.Text = AppName + " · 端口 " + Port;

        var menu = new ContextMenuStrip();
        menu.Items.Add("打开界面", null, delegate { OpenUi(); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("停止服务并退出", null, delegate
        {
            Tray.Text = AppName + " · 正在停止…";
            StopService();
            Application.Exit();
        });
        menu.Items.Add("退出启动器（保留服务）", null, delegate { Application.Exit(); });
        Tray.ContextMenuStrip = menu;
        Tray.DoubleClick += delegate { OpenUi(); };
        Tray.Visible = true;
        Tray.ShowBalloonTip(2500, AppName, "服务已就绪，端口 " + Port, ToolTipIcon.Info);
    }

    static void HideTray()
    {
        if (Tray == null) return;
        Tray.Visible = false;
        Tray.Dispose();
        Tray = null;
    }

    // ---------------------------------------------------------------- HTTP
    static bool Ping()
    {
        var body = HttpGetSafe(BaseUrl + "/health", 800);
        return body != null && body.IndexOf("\"ok\"", StringComparison.Ordinal) >= 0;
    }

    static string HttpGetSafe(string url, int timeoutMs)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            req.Proxy = null; // 本机回环不要走系统代理
            req.KeepAlive = false;
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                return sr.ReadToEnd();
        }
        catch { return null; }
    }

    static string HttpPostSafe(string url, string body, Dictionary<string, string> headers, int timeoutMs)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "POST";
            req.ContentType = "application/json";
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            req.Proxy = null;
            req.KeepAlive = false;
            if (headers != null) foreach (var kv in headers) req.Headers[kv.Key] = kv.Value;
            var bytes = Encoding.UTF8.GetBytes(body);
            req.ContentLength = bytes.Length;
            using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                return sr.ReadToEnd();
        }
        catch { return null; }
    }

    static string JsonString(string json, string key)
    {
        if (json == null) return null;
        var k = "\"" + key + "\":\"";
        var i = json.IndexOf(k, StringComparison.Ordinal);
        if (i < 0) return null;
        i += k.Length;
        var e = json.IndexOf('"', i);
        if (e < 0) return null;
        return json.Substring(i, e - i);
    }
}

/// <summary>启动时的等待小窗：模型加载期间给个明确的反馈，不然双击没反应像坏了。</summary>
class SplashForm : Form
{
    Label label;

    public SplashForm(float scale)
    {
        if (scale < 1f) scale = 1f;
        AutoScaleMode = AutoScaleMode.None;
        Text = Launcher.AppName;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ControlBox = false;
        ClientSize = new Size((int)(360 * scale), (int)(96 * scale));
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
        catch { }

        label = new Label();
        label.AutoSize = false;
        label.TextAlign = ContentAlignment.MiddleCenter;
        label.SetBounds((int)(16 * scale), (int)(16 * scale), (int)(328 * scale), (int)(28 * scale));
        label.Text = "正在启动模型服务…";
        Controls.Add(label);

        var bar = new ProgressBar();
        bar.Style = ProgressBarStyle.Marquee;
        bar.MarqueeAnimationSpeed = 30;
        bar.SetBounds((int)(16 * scale), (int)(52 * scale), (int)(328 * scale), (int)(18 * scale));
        Controls.Add(bar);
    }

    public void SetStatus(string text)
    {
        if (label != null) label.Text = text;
    }
}
