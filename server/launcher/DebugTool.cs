// Debugging Tool —— 独立的调试窗口（WebView2）
//
// 为什么不用浏览器 --app 模式：那种窗口的图标来自网页 favicon，任务栏里会被缩成糊的。
// 独立 exe 用 /win32icon:debug.ico 编译，Windows 直接按尺寸取 ico，标题栏/任务栏都清晰。
//
// 用法：DebugTool.exe [url]
//   默认 http://127.0.0.1:8099/debug
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class Program
{
    const string AppName = "Debugging Tool · 本地 AI";
    static string BaseUrl = "http://127.0.0.1:8099";

    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string url = BaseUrl + "/debug";
        if (args.Length > 0 && args[0].StartsWith("http", StringComparison.OrdinalIgnoreCase)) url = args[0];
        try { var u = new Uri(url); BaseUrl = u.Scheme + "://" + u.Authority; } catch { }

        if (!PortOpen(new Uri(BaseUrl).Host, new Uri(BaseUrl).Port))
        {
            MessageBox.Show(
                "本地 AI 服务没在运行（" + BaseUrl + "）。\n\n" +
                "请先启动 启动本地AI.exe，再点「Debug」。\n" +
                "（服务真起不来时，用程序目录里的 localai-debug.cmd 看本机诊断。）",
                AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        float scale = 1f;
        using (var g = Graphics.FromHwnd(IntPtr.Zero)) { scale = g.DpiX / 96f; }

        var form = new Form();
        form.AutoScaleMode = AutoScaleMode.None;
        form.Text = AppName;
        form.StartPosition = FormStartPosition.CenterScreen;
        var wa = Screen.PrimaryScreen.WorkingArea;
        form.ClientSize = new Size(
            Math.Min((int)(1180 * scale), wa.Width - (int)(60 * scale)),
            Math.Min((int)(860 * scale), wa.Height - (int)(90 * scale)));
        form.MinimumSize = new Size((int)(860 * scale), (int)(600 * scale));
        try { form.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        var wv = new WebView2();
        wv.Dock = DockStyle.Fill;
        var props = new CoreWebView2CreationProperties();
        var dir = Path.GetDirectoryName(Application.ExecutablePath);
        props.UserDataFolder = Path.Combine(dir, "data", "webview2-debug");
        wv.CreationProperties = props;

        wv.CoreWebView2InitializationCompleted += delegate(object s, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (e.IsSuccess) return;
            var why = e.InitializationException != null ? e.InitializationException.Message : "未知原因";
            try { form.Close(); } catch { }
            try { Process.Start(url); } catch { }
            MessageBox.Show("WebView2 初始化失败（" + why + "），已改用默认浏览器打开。",
                AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        };

        form.Controls.Add(wv);
        form.Show();
        if (form.WindowState != FormWindowState.Normal) form.WindowState = FormWindowState.Normal;
        form.Activate();
        wv.Source = new Uri(url);
        Application.Run(form);
    }

    static bool PortOpen(string host, int port)
    {
        try
        {
            using (var c = new TcpClient())
            {
                var t = c.BeginConnect(host, port, null, null);
                if (!t.AsyncWaitHandle.WaitOne(1200)) return false;
                c.EndConnect(t);
                return true;
            }
        }
        catch { return false; }
    }
}
