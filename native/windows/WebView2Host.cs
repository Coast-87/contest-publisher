// WebView2Host.cs — Contest Publisher 的 Windows 原生窗口宿主。
//
// 为什么存在：应用是本地 HTTP 服务 + Web 工作台，Windows 端此前靠 Edge/Chrome 的
// --app 模式给"独立窗口"，但 Win11 的启动加速/进程交接会让 spawn 秒退、窗口归属
// 不明，还可能叠开系统默认浏览器。WebView2（Win10/11 系统自带运行时）嵌入本进程
// 窗口，窗口归我们所有，与浏览器彻底无关。
//
// 两个实测坑（都修在这里）：
// 1. 系统代理（clash 等）开着时，127.0.0.1 的页面请求与探活都会被劫持到代理端口 →
//    页面打不开 + 看门狗误杀窗口。对策：探活 Proxy=null 直连 + WebView2 加
//    --no-proxy-server（页面内 fetch 同样免疫）。
// 2. 用户数据目录被残留浏览器进程锁着 → CreateAsync 抛 0x8007139F。对策：目录里放
//    启动序号保证独占；CreateAsync 失败换全新目录重试一次。
//
// 用法: ContestPublisher.WebView2Host.exe <url>
//   窗口关闭 → 进程退出（启动器据此判定会话结束）
//   本地服务消失（用户在界面点了「退出软件」）→ 连续探活失败 → 自动关窗退出
// 编译: build-win.sh 里用 .NET Framework 自带的 csc 编译（无需装 SDK）

using System;
using System.Drawing;
using System.IO;
using System.Net;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

class WebView2Host : Form
{
    private readonly string url;
    private readonly System.Windows.Forms.Timer watchdog;
    private int probeFailures = 0;
    private WebView2 webView;
    private string userDataDir;
    private static int userDataSeq = 0;

    internal static void Log(string line)
    {
        try
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Contest Publisher");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "webview2-host.log"), DateTime.Now.ToString("HH:mm:ss.fff") + " " + line + Environment.NewLine);
        }
        catch { }
    }

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length == 0 || args[0].IndexOf("http", StringComparison.Ordinal) != 0)
        {
            MessageBox.Show("用法: ContestPublisher.WebView2Host.exe <http://127.0.0.1:port>", "Contest Publisher",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Environment.Exit(2);
        }
        Log("main: args ok, url=" + args[0]);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.ThreadException += (s, e) => { Log("ThreadException: " + e.Exception); };
        AppDomain.CurrentDomain.UnhandledException += (s, e) => { Log("UnhandledException: " + e.ExceptionObject); };
        Application.Run(new WebView2Host(args[0]));
        Log("main: Application.Run returned, exiting normally");
    }

    private WebView2Host(string url)
    {
        this.url = url;

        Text = "Contest Publisher";
        var screen = Screen.PrimaryScreen != null ? Screen.PrimaryScreen.WorkingArea : new Rectangle(0, 0, 1440, 920);
        var width = Math.Min(1440, screen.Width - 40);
        var height = Math.Min(920, screen.Height - 40);
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(width, height);
        try
        {
            var iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets", "icon.ico");
            if (File.Exists(iconPath)) Icon = new Icon(iconPath);
        }
        catch { /* 图标缺失不影响功能 */ }

        webView = new WebView2();
        webView.Dock = DockStyle.Fill;
        Controls.Add(webView);

        // 服务消失 → 自动关窗（「退出软件」按钮会停掉服务）
        watchdog = new System.Windows.Forms.Timer { Interval = 2000 };
        watchdog.Tick += (s, e) => ProbeServer();
        watchdog.Start();
        Log("ctor: watchdog started");

        Shown += (s, e) => Log("form shown (visible on screen)");
        FormClosed += (s, e) => Log("form closed: reason=" + e.CloseReason);
        FormClosing += (s, e) => TryDeleteDir(userDataDir);
        Load += async (s, e) =>
        {
            // 内部各自 try/catch：await 不能出现在 catch 子句体里（CS1985）
            var ok = await TryInitWebViewAsync(false) || await TryInitWebViewAsync(true);
            if (!ok)
            {
                MessageBox.Show("WebView2 初始化失败（运行时应随 Windows 10/11 预装）：\n详见 %LOCALAPPDATA%\\Contest Publisher\\webview2-host.log",
                    "Contest Publisher", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Environment.Exit(3);
            }
        };
    }

    private async System.Threading.Tasks.Task<bool> TryInitWebViewAsync(bool freshDir)
    {
        try
        {
            await InitWebViewAsync(freshDir);
            return true;
        }
        catch (Exception ex)
        {
            Log("webview2 init failed (fresh=" + freshDir + "): " + ex);
            return false;
        }
    }

    private async System.Threading.Tasks.Task InitWebViewAsync(bool freshDir)
    {
        var baseDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Contest Publisher", "webview2-profile");
        // 每次启动带唯一后缀：绝无「目录被残留浏览器进程锁住」的 0x8007139F
        userDataDir = baseDir + "-" + (freshDir ? "r" + (++userDataSeq) + "-" : "") + DateTime.Now.Ticks.ToString("x");
        Log("webview2 init: user-data=" + userDataDir);
        // --no-proxy-server：页面内 fetch 不许走系统代理（代理工具开着时 127.0.0.1 会被劫持）
        var opts = new Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions();
        opts.AdditionalBrowserArguments = "--no-proxy-server";
        var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, userDataDir, opts);
        await webView.EnsureCoreWebView2Async(env);
        webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
        webView.CoreWebView2.NewWindowRequested += (s2, e2) =>
        {
            // 工作台是单页应用：外部新窗口请求一律拦在本窗口内打开，绝不弹浏览器
            e2.Handled = true;
            webView.CoreWebView2.Navigate(e2.Uri);
        };
        webView.Source = new Uri(url);
        Log("webview2 navigated: " + url);
    }

    private static void TryDeleteDir(string dir)
    {
        try { if (dir != null && Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
    }

    private void ProbeServer()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url + "/api/health");
            req.Method = "GET";
            req.Timeout = 1500;
            // 本机服务绝不能走系统代理：代理工具（clash 等）开着时 127.0.0.1 会被劫持，
            // 探活全败 → 看门狗误杀窗口。Proxy=null = 直连。
            req.Proxy = null;
            using (var resp = (HttpWebResponse)req.GetResponse())
            {
                probeFailures = resp.StatusCode == HttpStatusCode.OK ? 0 : probeFailures + 1;
            }
        }
        catch
        {
            probeFailures += 1;
        }
        Log("probe: failures=" + probeFailures);
        // 5 次（10 秒）才判死，降低误杀概率
        if (probeFailures >= 5)
        {
            watchdog.Stop();
            Log("watchdog close: server unreachable");
            Close(); // 服务已死（退出软件/进程被杀），窗口跟着走
        }
    }
}
