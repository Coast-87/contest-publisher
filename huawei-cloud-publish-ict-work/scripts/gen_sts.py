#!/usr/bin/env python3
"""gen_sts.py — 生成最小权限 STS 临时凭证（SELF_VERIFY 自委托 AssumeAgency）

契约（与 api.mjs --creds-file / --auto-refresh 对齐）：
  - 输出 sts-creds.json（camelCase）与 sts-creds.sh（STS_AK/STS_SK/STS_TOKEN）。
  - _refresh 写入 { accountId, agencyUrn, region, hcloudExe }，供 api.mjs 401 时自动刷新。

用法:
  python gen_sts.py --account <账号ID> [--hcloud <绝对路径>] \\
      [--region cn-north-4] [--dur 900] [--session publish-<ts>] \\
      [--creds-out <json>] [--sh-out <sh>]
  AK/SK/TOKEN 由 hcloud 读取（HUAWEICLOUD_SDK_AK/SK[/SECURITY_TOKEN] 或 hcloud 已配置）。
  hcloud 探测：--hcloud → HCLOUD_EXE → PATH（仅按 PATH，不扫固定目录，工具统一经 ensure-user-bindir.mjs 暴露）。
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import shutil
import time
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

REGION = "cn-north-4"
DURATION_SECONDS = 900
POLICY = {
    "Version": "5.0",
    "Statement": [{"Effect": "Allow", "Action": ["sts::GetCallerIdentity", "iam::listAuthDomains"], "Resource": ["*"]}],
}

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def resolve_hcloud(explicit: str) -> str:
    if explicit:
        p = Path(explicit).resolve()
        if p.exists():
            return str(p)
        sys.exit(f"❌ --hcloud 指定路径不存在: {p}")

    # 探测顺序: --hcloud → HCLOUD_EXE → PATH(shutil.which)。
    # 仅按 PATH 查找，不扫描固定目录——工具统一经 ensure-user-bindir.mjs 目录暴露。
    _exe_env = os.environ.get("HCLOUD_EXE", "").strip()
    if _exe_env:
        p = Path(_exe_env).expanduser().resolve()
        if p.exists():
            return str(p)
    _which = shutil.which("hcloud")
    if _which:
        return str(_which)
    sys.exit("❌ 未找到 hcloud（不在 PATH）。请安装 KooCLI 并确保其目录在 PATH（可经 ensure-user-bindir.mjs），或传 --hcloud <绝对路径>")


def normalize_aksk_env():
    """AK/SK/Token 环境变量归一化：hcloud 只认 HUAWEICLOUD_SDK_AK/SK/SECURITY_TOKEN，
    按优先级回退别名，命中别名时注入 SDK 变量名，供 hcloud 子进程读取。
    仅当 SDK 变量未设置且别名命中时才写，不覆盖用户显式设置的 SDK 变量。"""
    chains = {
        "HUAWEICLOUD_SDK_AK": ["HUAWEICLOUD_AK", "HW_ACCESS_KEY"],
        "HUAWEICLOUD_SDK_SK": ["HUAWEICLOUD_SK", "HW_SECRET_KEY"],
        "HUAWEICLOUD_SDK_SECURITY_TOKEN": ["HUAWEICLOUD_SECURITY_TOKEN", "HW_SECURITY_TOKEN"],
    }
    for sdk, aliases in chains.items():
        if os.environ.get(sdk):
            continue
        for a in aliases:
            if os.environ.get(a):
                os.environ[sdk] = os.environ[a]
                break


def aksk_cli_args() -> list:
    """KooCLI 7.2.12 Windows 专项：经 env 传 AK/SK 存在签名始终 401 的缺陷，
    命令行参数优先级最高可绕开。与 vendored resolve-domain.mjs 的 akskCliArgs 同源同因；
    env 未设置时返回空列表，不影响 hcloud 自身已 configure 的持久配置。"""
    ak = os.environ.get("HUAWEICLOUD_SDK_AK", "")
    sk = os.environ.get("HUAWEICLOUD_SDK_SK", "")
    tok = os.environ.get("HUAWEICLOUD_SDK_SECURITY_TOKEN", "")
    args = []
    if ak:
        args.append(f"--cli-access-key={ak}")
    if sk:
        args.append(f"--cli-secret-key={sk}")
    if tok:
        args.append(f"--cli-security-token={tok}")
    return args


def strip_ansi(s: str) -> str:
    return _ANSI_RE.sub("", s)


def extract_json_object(text: str):
    """hcloud 的 stdout 可能混有告警行（如「获取项目ID失败」）与帮助尾注，
    不能整段 json.loads——扫描并返回其中第一个可解析的 JSON 对象。"""
    dec = json.JSONDecoder()
    for idx, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            obj, _end = dec.raw_decode(text, idx)
            return obj
        except json.JSONDecodeError:
            continue
    return None


def run_hcloud(cmd: list) -> str:
    """执行 hcloud 并返回 UTF-8 解码后的 stdout。

    两个实测行为（KooCLI 7.2.12，中文 Windows）：
    1. text=True 缺省按 locale（GBK）解码 hcloud 的 UTF-8 输出 → 解码线程崩溃 → stdout=None，
       随后 json.loads(None) 抛 TypeError。必须显式 encoding="utf-8" + errors="replace"。
    2. 业务失败（USE_ERROR / 签名失败 / 参数错）也 exit 0，错误文本带 ANSI 色码写在 stdout，
       因此不能只看退出码，调用方需对 stdout 做错误标记识别。
    """
    try:
        result = subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="replace", check=True)
    except subprocess.CalledProcessError as e:
        msg = strip_ansi((e.stderr or "") or (e.stdout or "")).strip() or str(e)
        sys.exit(
            f"❌ hcloud STS AssumeAgency 失败: {msg}\n"
            "请检查 AK/SK/账号 ID（HUAWEICLOUD_SDK_AK/SK 或别名 HUAWEICLOUD_AK/SK、HW_ACCESS_KEY/HW_SECRET_KEY），"
            "或按 references/troubleshooting.md 排查。"
        )
    except OSError as e:
        sys.exit(f"❌ 无法启动 hcloud: {e}")
    return result.stdout or ""


def gen_sts_via_sdk(account: str, region: str, session: str, dur: int):
    """官方 Python SDK 回退路径（华为云 IAM 子用户 AK/SK 必须走这条）。

    KooCLI/手写裸签名对「子用户 + 全局服务」组合一律 401：全局服务签名通道要求
    domain 参与认证（GlobalCredentials(ak, sk, domain)），hcloud 无该能力、
    手写签名不带 domain 头。官方 core Signer 用 GlobalCredentials 签 STS
    POST /v5/agencies/assume 已实测打通。注意 policy 必须是 JSON 字符串而非对象。
    依赖: pip install --user huaweicloudsdkcore
    返回 credentials dict（access_key_id / secret_access_key / security_token）。
    """
    ak = os.environ.get("HUAWEICLOUD_SDK_AK", "")
    sk = os.environ.get("HUAWEICLOUD_SDK_SK", "")
    if not ak or not sk:
        sys.exit("❌ SDK 回退路径需要环境变量 HUAWEICLOUD_SDK_AK/SK（hcloud 配置无法读取）")
    try:
        from huaweicloudsdkcore.auth.credentials import GlobalCredentials
        from huaweicloudsdkcore.signer.signer import Signer
        from huaweicloudsdkcore.sdk_request import SdkRequest
    except ImportError:
        sys.exit("❌ SDK 回退路径缺少依赖: pip install --user huaweicloudsdkcore")

    creds = GlobalCredentials(ak, sk, account)
    signer = Signer(creds)
    body = json.dumps({
        "agency_urn": f"iam::{account}:agency:SELF_VERIFY",
        "agency_session_name": session,
        "duration_seconds": dur,
        "policy": json.dumps(POLICY),
    }).encode()
    req = SdkRequest(
        method="POST",
        schema="https",
        host=f"sts.{region}.myhuaweicloud.com",
        resource_path="/v5/agencies/assume",
        query_params=[],
        header_params={"Content-Type": "application/json"},
        body=body,
    )
    signed = signer.sign(req)
    try:
        import urllib.request
        http_req = urllib.request.Request(
            f"https://sts.{region}.myhuaweicloud.com/v5/agencies/assume",
            data=body,
            headers=dict(signed.header_params),
        )
        with urllib.request.urlopen(http_req, timeout=15) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:200]
        sys.exit(f"❌ SDK 路径 STS AssumeAgency 失败（HTTP {e.code}）: {detail}")
    c = payload.get("credentials")
    if not c or not c.get("access_key_id"):
        sys.exit(f"❌ STS 响应缺 credentials: {json.dumps(payload, ensure_ascii=False)[:200]}")
    return c


def main():
    ap = argparse.ArgumentParser(
        prog="gen_sts.py",
        description="生成最小权限 STS 临时凭证（写 sts-creds.json + sts-creds.sh）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--account", required=True, help="华为云账号 ID（Domain ID）")
    ap.add_argument("--hcloud", default="", help="hcloud 可执行文件绝对路径")
    ap.add_argument("--region", default=REGION, help=f"区域（默认 {REGION}）")
    ap.add_argument("--dur", type=int, default=DURATION_SECONDS, help=f"凭证有效期秒数（默认 {DURATION_SECONDS}）")
    ap.add_argument("--session", default=f"publish-{int(time.time() * 1000)}", help="会话名")
    ap.add_argument("--creds-out", default="", help="凭证 JSON 输出路径（默认 tmpdir/sts-creds.json）")
    ap.add_argument("--sh-out", default="", help="凭证 sh 输出路径（默认 tmpdir/sts-creds.sh）")
    ap.add_argument("--sdk", action="store_true",
                    help="强制走官方 Python SDK 签名（IAM 子用户 AK/SK 必须加此项；hcloud 不支持子用户全局服务签名）")
    args = ap.parse_args()

    normalize_aksk_env()

    if args.sdk or (os.environ.get("HUAWEICLOUD_SDK_AK") and os.environ.get("GEN_STS_FORCE_SDK") == "1"):
        c = gen_sts_via_sdk(args.account, args.region, args.session, args.dur)
        hcloud_exe = os.environ.get("HCLOUD_EXE", "sdk-fallback")
        agency_urn = f"iam::{args.account}:agency:SELF_VERIFY"
        creds_out = args.creds_out or str(Path(tempfile.gettempdir()) / "sts-creds.json")
        sh_out = args.sh_out or str(Path(tempfile.gettempdir()) / "sts-creds.sh")
        camel = {
            "accessKeyId": c["access_key_id"],
            "secretAccessKey": c["secret_access_key"],
            "securityToken": c["security_token"],
            "_refresh": {"accountId": args.account, "agencyUrn": agency_urn, "region": args.region,
                         "hcloudExe": hcloud_exe, "mode": "sdk"},
        }
        Path(creds_out).write_text(json.dumps(camel, indent=2, ensure_ascii=False), encoding="utf-8")
        Path(sh_out).write_text(
            f"export STS_AK='{c['access_key_id']}'\n"
            f"export STS_SK='{c['secret_access_key']}'\n"
            f"export STS_TOKEN='{c['security_token']}'\n",
            encoding="utf-8",
        )
        print(f"[gen-sts] 已写入 {creds_out}（+ {sh_out}），mode=sdk（子用户回退路径）")
        return

    hcloud_exe = resolve_hcloud(args.hcloud)
    agency_urn = f"iam::{args.account}:agency:SELF_VERIFY"
    creds_out = args.creds_out or str(Path(tempfile.gettempdir()) / "sts-creds.json")
    sh_out = args.sh_out or str(Path(tempfile.gettempdir()) / "sts-creds.sh")

    cmd = [
        hcloud_exe, "STS", "AssumeAgency",
        f"--cli-region={args.region}",
        f"--agency_urn={agency_urn}",
        f"--agency_session_name={args.session}",
        f"--duration_seconds={args.dur}",
        f"--policy={json.dumps(POLICY)}",
        # 显式锁定 JSON 输出，避免受用户 hcloud 配置的输出格式影响
        "--cli-output=json",
        *aksk_cli_args(),
    ]

    out = strip_ansi(run_hcloud(cmd))

    # hcloud 业务失败也 exit 0（见 run_hcloud 注释）：先识别错误标记，再尝试解析
    err_line = next(
        (ln.strip() for ln in out.splitlines() if "[USE_ERROR]" in ln or "[ERROR]" in ln),
        "",
    )
    if err_line:
        hint = (
            "hcloud 缺少 AK/SK 配置：执行 hcloud configure set --access-key=<AK> --secret-key=<SK> --cli-region=<region>，"
            "或设置环境变量 HUAWEICLOUD_SDK_AK/SK（别名 HUAWEICLOUD_AK/SK、HW_ACCESS_KEY/HW_SECRET_KEY）"
        )
        sys.exit(f"❌ hcloud STS AssumeAgency 失败: {err_line}\n{hint}")

    c = extract_json_object(out)
    if c is None:
        head = " ".join(out.split())[:300]
        sys.exit(f"❌ hcloud 输出中未找到 JSON 响应。原始输出（已去色码）：{head}")

    if not isinstance(c, dict) or "credentials" not in c:
        code = c.get("error_code", "未知错误码") if isinstance(c, dict) else type(c).__name__
        emsg = c.get("error_msg", "") if isinstance(c, dict) else str(c)[:200]
        sys.exit(
            f"❌ STS 响应异常（{code}）：{emsg}\n"
            "请检查 AK/SK 是否有效、账号 ID 是否正确，或按 references/troubleshooting.md 排查。"
        )

    camel = {
        "accessKeyId": c["credentials"]["access_key_id"],
        "secretAccessKey": c["credentials"]["secret_access_key"],
        "securityToken": c["credentials"]["security_token"],
        "_refresh": {"accountId": args.account, "agencyUrn": agency_urn, "region": args.region, "hcloudExe": hcloud_exe},
    }
    Path(creds_out).write_text(json.dumps(camel, indent=2, ensure_ascii=False), encoding="utf-8")
    Path(sh_out).write_text(
        f"export STS_AK='{c['credentials']['access_key_id']}'\n"
        f"export STS_SK='{c['credentials']['secret_access_key']}'\n"
        f"export STS_TOKEN='{c['credentials']['security_token']}'\n",
        encoding="utf-8",
    )
    print(f"[gen-sts] 已写入 {creds_out}（+ {sh_out}），_refresh 含 hcloudExe={hcloud_exe}")


if __name__ == "__main__":
    main()
