// WebView2Host.cs — Contest Publisher 的 Windows 原生窗口宿主。
//
// 为什么存在：应用是本地 HTTP 服务 + Web 工作台，Windows 端此前靠 Edge/Chrome 的
// --app 模式给"独立窗口"，但 Win11 的启动加速/进程交接会让 spawn 秒退、窗口归属
// 不明，还可能叠开系统默认浏览器。WebView2（Win10/11 系统自带运行时）嵌入本进程
// 窗口，窗口归我们所有，与浏览器彻底无关。
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

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length == 0 || args[0].IndexOf("http", StringComparison.Ordinal) != 0)
        {
            MessageBox.Show("用法: ContestPublisher.WebView2Host.exe <http://127.0.0.1:port>", "Contest Publisher",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Environment.Exit(2);
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new WebView2Host(args[0]));
    }

    private WebView2Host(string url)
    {
        this.url = url;

        Text = "Contest Publisher";
        var screen = Screen.PrimaryScreen.WorkingArea;
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

        Load += async (s, e) =>
        {
            try
            {
                var userData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Contest Publisher", "webview2-profile");
                var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, userData);
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
            }
            catch (Exception ex)
            {
                MessageBox.Show("WebView2 初始化失败（运行时应随 Windows 10/11 预装）：\n" + ex.Message,
                    "Contest Publisher", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Environment.Exit(3);
            }
        };
    }

    private void ProbeServer()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url + "/api/health");
            req.Method = "GET";
            req.Timeout = 1500;
            using (var resp = (HttpWebResponse)req.GetResponse())
            {
                probeFailures = resp.StatusCode == HttpStatusCode.OK ? 0 : probeFailures + 1;
            }
        }
        catch
        {
            probeFailures += 1;
        }
        if (probeFailures >= 3)
        {
            watchdog.Stop();
            Close(); // 服务已死（退出软件/进程被杀），窗口跟着走
        }
    }
}
