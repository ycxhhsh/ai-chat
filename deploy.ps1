<#
.SYNOPSIS
    CoThink AI 一键部署脚本 (PowerShell)
.DESCRIPTION
    通过 SSH 密钥认证，使用 rsync/scp 将本地代码同步到远程服务器，
    并重启 Docker 服务。
.USAGE
    .\deploy.ps1              # 全量部署 (前端build + 后端同步 + 重启)
    .\deploy.ps1 -Frontend    # 仅部署前端
    .\deploy.ps1 -Backend     # 仅部署后端
    .\deploy.ps1 -Quick       # 快速同步 (跳过 npm build)
#>

param(
    [switch]$Frontend,
    [switch]$Backend,
    [switch]$Quick,
    [switch]$Help
)

# ============ 配置 ============
$SERVER_IP   = "101.37.214.150"
$SERVER_USER = "root"
$SERVER_PATH = "/opt/cothink"
$SSH_KEY     = "$env:USERPROFILE\.ssh\id_ed25519"
$SSH_OPTS    = "-i `"$SSH_KEY`" -o StrictHostKeyChecking=no"

# 颜色输出
function Write-Step($msg)    { Write-Host "[=>] $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Fail($msg)    { Write-Host "[!!] $msg" -ForegroundColor Red }

# ============ 帮助 ============
if ($Help) {
    Get-Help $MyInvocation.MyCommand.Definition -Detailed
    exit 0
}

# 默认全量部署
$DeployFrontend = $true
$DeployBackend  = $true

if ($Frontend -and -not $Backend) { $DeployBackend = $false }
if ($Backend -and -not $Frontend) { $DeployFrontend = $false }

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  CoThink AI Deploy" -ForegroundColor Yellow
Write-Host "  Target: ${SERVER_USER}@${SERVER_IP}:${SERVER_PATH}" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

# ============ 检查 SSH 连接 ============
Write-Step "检查 SSH 连接..."
$sshTest = ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10 "${SERVER_USER}@${SERVER_IP}" "echo OK" 2>&1
if ($sshTest -ne "OK") {
    Write-Fail "SSH 连接失败！请检查密钥和服务器配置"
    Write-Fail "错误: $sshTest"
    exit 1
}
Write-Success "SSH 连接正常"

# ============ 前端部署 ============
if ($DeployFrontend) {
    if (-not $Quick) {
        Write-Step "构建前端..."
        Push-Location "$ProjectRoot\frontend"
        npm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "前端构建失败！"
            Pop-Location
            exit 1
        }
        Pop-Location
        Write-Success "前端构建完成"
    }

    Write-Step "同步前端到服务器..."
    # 用 scp 递归上传 dist 目录 (Windows 原生支持)
    # 先清空旧文件再上传
    ssh -i $SSH_KEY -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_IP}" "rm -rf ${SERVER_PATH}/frontend/dist"
    scp -i $SSH_KEY -o StrictHostKeyChecking=no -r "$ProjectRoot\frontend\dist" "${SERVER_USER}@${SERVER_IP}:${SERVER_PATH}/frontend/dist"
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "前端同步失败！"
        exit 1
    }
    Write-Success "前端同步完成"
}

# ============ 后端部署 ============
if ($DeployBackend) {
    Write-Step "同步后端到服务器..."

    # 创建临时排除列表
    $excludeFile = [System.IO.Path]::GetTempFileName()
    @(
        "__pycache__",
        "*.pyc",
        ".env",
        ".venv",
        "venv",
        "*.egg-info",
        ".git",
        "node_modules",
        "tests"
    ) | Set-Content $excludeFile

    # 同步后端文件 (使用 scp 逐个关键目录)
    # 先打包再传输，避免逐文件 scp 的开销
    Write-Step "打包后端代码..."
    $backendArchive = "$env:TEMP\cothink_backend.tar.gz"

    Push-Location "$ProjectRoot\backend"
    tar -czf $backendArchive --exclude="__pycache__" --exclude="*.pyc" --exclude=".env" --exclude=".venv" --exclude="venv" --exclude="*.egg-info" --exclude=".git" --exclude="node_modules" --exclude="tests" .
    Pop-Location

    scp -i $SSH_KEY -o StrictHostKeyChecking=no $backendArchive "${SERVER_USER}@${SERVER_IP}:/tmp/cothink_backend.tar.gz"
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "后端上传失败！"
        Remove-Item $backendArchive -ErrorAction SilentlyContinue
        Remove-Item $excludeFile -ErrorAction SilentlyContinue
        exit 1
    }

    # 服务器端解包
    ssh -i $SSH_KEY -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_IP}" @"
cd ${SERVER_PATH}/backend && \
tar -xzf /tmp/cothink_backend.tar.gz && \
rm /tmp/cothink_backend.tar.gz
"@

    Remove-Item $backendArchive -ErrorAction SilentlyContinue
    Remove-Item $excludeFile -ErrorAction SilentlyContinue
    Write-Success "后端同步完成"

    # 重建并重启后端容器
    Write-Step "重启后端服务..."
    ssh -i $SSH_KEY -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_IP}" @"
cd ${SERVER_PATH} && \
docker compose build backend && \
docker compose up -d backend ai-worker grading-worker
"@
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "后端重启失败！"
        exit 1
    }
    Write-Success "后端服务已重启"
}

# ============ 健康检查 ============
Write-Step "等待服务启动 (10s)..."
Start-Sleep -Seconds 10

Write-Step "执行健康检查..."
$healthResult = ssh -i $SSH_KEY -o StrictHostKeyChecking=no "${SERVER_USER}@${SERVER_IP}" "curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/healthz 2>/dev/null || echo 'FAIL'"
if ($healthResult -eq "200") {
    Write-Success "后端健康检查通过 (HTTP 200)"
} else {
    Write-Fail "后端健康检查失败 (返回: $healthResult)"
    Write-Host "查看日志: ssh -i $SSH_KEY ${SERVER_USER}@${SERVER_IP} 'docker compose -f ${SERVER_PATH}/docker-compose.yml logs --tail=30 backend'" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  部署完成!" -ForegroundColor Green
Write-Host "  访问: http://${SERVER_IP}" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
