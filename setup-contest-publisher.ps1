# setup-contest-publisher.ps1 — Contest Publisher Windows 一键环境安装
# 双击「一键安装环境.cmd」即运行本脚本；也可 PowerShell 里直接执行。
# 做四件事：
#   1. 安装 KooCLI (hcloud)        —— 调同目录 install-hcloud.ps1（幂等，装过自动跳过）
#   2. 安装 STS SDK 回退依赖       —— pip install --user huaweicloudsdkcore
#   3. 写入 AK/SK 用户环境变量     —— HUAWEICLOUD_SDK_AK / HUAWEICLOUD_SDK_SK（credentials.csv 或提示输入）
#   4. 端到端校验                  —— 用 gen_sts.py 真实生成一次 STS 临时凭证
# 退出码: 0=全部就绪; 1=某步失败（红字提示，窗口停住等你看完）

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Scripts = Join-Path $ScriptDir "huawei-cloud-publish-ict-work\scripts"
$GenSts = Join-Path $Scripts "gen_sts.py"

function Step($n, $m) { Write-Host ""; Write-Host "==> [$n/4] $m" -ForegroundColor Cyan }
function Ok($m)       { Write-Host "    OK $m" -ForegroundColor Green }
function Warn($m)     { Write-Host "    !! $m" -ForegroundColor Yellow }
function Die($m)      { Write-Host "    X $m" -ForegroundColor Red; Write-Host ""; Read-Host "按回车关闭窗口"; exit 1 }

if (-not (Test-Path $GenSts)) { Die "未找到 $GenSts —— 请把本脚本放在发行包根目录（与 huawei-cloud-publish-ict-work 同级）" }

# ---- 1/4 KooCLI ----
Step 1 "安装 KooCLI (hcloud)"
try {
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Scripts "install-hcloud.ps1") 2>&1
    $out | ForEach-Object { Write-Host "    $_" }
    $hcloud = ($out | Select-String "#hcloud=" | ForEach-Object { ($_ -split "=", 2)[1].Trim() } | Select-Object -First 1)
    if (-not $hcloud) { Die "install-hcloud.ps1 未输出 #hcloud=" }
    Ok "hcloud = $hcloud"
} catch { Die "KooCLI 安装失败: $($_.Exception.Message)" }

# ---- 2/4 Python + SDK 依赖 ----
Step 2 "安装 STS SDK 回退依赖 (huaweicloudsdkcore)"
$py = Get-Command py -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command python -ErrorAction SilentlyContinue }
if (-not $py) { Die "未找到 Python（py / python 均不在 PATH）。请安装 Python 3.10+ 后重试" }
$pyCmd = $py.Source
& $pyCmd --version | ForEach-Object { Write-Host "    $_" }
& $pyCmd -m pip install --quiet --user huaweicloudsdkcore
if ($LASTEXITCODE -ne 0) { Die "pip install huaweicloudsdkcore 失败（检查网络/代理）" }
& $pyCmd -c "import huaweicloudsdkcore; print('    huaweicloudsdkcore', huaweicloudsdkcore.__version__ if hasattr(huaweicloudsdkcore,'__version__') else 'installed')"
Ok "SDK 依赖就绪"

# ---- 3/4 AK/SK 环境变量 ----
Step 3 "写入 AK/SK 用户环境变量"
$ak = [Environment]::GetEnvironmentVariable('HUAWEICLOUD_SDK_AK', 'User')
$sk = [Environment]::GetEnvironmentVariable('HUAWEICLOUD_SDK_SK', 'User')
$csv = Join-Path $ScriptDir "credentials.csv"
if ($ak -and $sk) {
    Ok "已有配置（HUAWEICLOUD_SDK_AK=$($ak.Substring(0,[Math]::Min(8,$ak.Length)))***），跳过"
} elseif (Test-Path $csv) {
    # 华为云控制台下载的 credentials.csv：User Name,Access Key Id,Secret Access Key
    $row = (Get-Content $csv | Where-Object { $_ -match ',' } | Select-Object -First 1) -split ','
    if ($row.Count -ge 3) {
        $ak = $row[-3].Trim('"').Trim()
        $sk = $row[-2].Trim('"').Trim()
        $ak2 = $row[-2].Trim('"').Trim(); $sk2 = $row[-1].Trim('"').Trim()
        # 兼容末列无引号/带 BOM 的两种排布：AK 在倒数第三或第二列
        if ($ak2 -match '^HPUA' -or $ak2 -match '^[A-Z0-9]{20}$') { $ak = $ak2; $sk = $sk2 }
        [Environment]::SetEnvironmentVariable('HUAWEICLOUD_SDK_AK', $ak, 'User')
        [Environment]::SetEnvironmentVariable('HUAWEICLOUD_SDK_SK', $sk, 'User')
        $env:HUAWEICLOUD_SDK_AK = $ak; $env:HUAWEICLOUD_SDK_SK = $sk
        Ok "已从 credentials.csv 写入用户环境变量（AK=$($ak.Substring(0,[Math]::Min(8,$ak.Length)))***）"
    } else { Die "credentials.csv 列数异常，请手动 setx HUAWEICLOUD_SDK_AK/SK" }
} else {
    Write-Host "    未找到 credentials.csv，请手动输入（输入值不会回显到屏幕）"
    $ak = Read-Host "    Access Key Id (AK)"
    $sk = Read-Host -MaskInput "    Secret Access Key (SK)"
    if (-not $ak -or -not $sk) { Die "AK/SK 不能为空" }
    [Environment]::SetEnvironmentVariable('HUAWEICLOUD_SDK_AK', $ak, 'User')
    [Environment]::SetEnvironmentVariable('HUAWEICLOUD_SDK_SK', $sk, 'User')
    $env:HUAWEICLOUD_SDK_AK = $ak; $env:HUAWEICLOUD_SDK_SK = $sk
    Ok "已写入用户环境变量"
}

# ---- 4/4 端到端校验：真实生成一次 STS ----
Step 4 "端到端校验（生成一次 STS 临时凭证）"
$accountId = Read-Host "    华为云账号 ID / Domain ID（32 位十六进制，应用配置里有）"
if ($accountId -notmatch '^[0-9a-fA-F]{32}$') { Die "账号 ID 格式不对（应为 32 位十六进制）" }
$testOut = Join-Path $env:TEMP "sts-setup-verify.json"
& $pyCmd $GenSts --account $accountId --hcloud $hcloud --creds-out $testOut --sh-out "$testOut.sh"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $testOut)) { Die "gen_sts.py 校验失败（见上方输出）" }
$creds = Get-Content $testOut -Raw | ConvertFrom-Json
Ok "STS 生成成功（AK=$($creds.accessKeyId.Substring(0,8))***，900 秒临时凭证）"
Remove-Item $testOut, "$testOut.sh" -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "全部就绪。回 Contest Publisher 点「生成 STS」即可（应用需重启以读取新环境变量）。" -ForegroundColor Green
Read-Host "按回车关闭窗口"
