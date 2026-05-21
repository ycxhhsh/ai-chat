<#
.SYNOPSIS
    Low-impact CoThink AI deployment script.
.DESCRIPTION
    Publishes backend and frontend without deleting live frontend assets.
    Frontend release order is assets first, index.html last.
    Backend release order is rollback tag, extract code, build image, migrate, restart.
.USAGE
    .\deploy.ps1
    .\deploy.ps1 -FrontendOnly
    .\deploy.ps1 -BackendOnly -NoMigrate
    .\deploy.ps1 -SmokeOnly
#>

param(
    [switch]$FrontendOnly,
    [switch]$BackendOnly,
    [switch]$SkipBuild,
    [switch]$NoMigrate,
    [switch]$SmokeOnly,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$SERVER_IP = "101.37.214.150"
$SERVER_USER = "root"
$SERVER_PATH = "/opt/cothink"
$SSH_KEY = "$env:USERPROFILE\.ssh\id_ed25519"
$REMOTE = "${SERVER_USER}@${SERVER_IP}"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Timestamp = Get-Date -Format "yyyyMMddHHmmss"
$RollbackImage = "cothink-backend:rollback-$Timestamp"
$RollbackIndex = "$SERVER_PATH/frontend/dist/index.prev-$Timestamp.html"
$DeployBackend = -not $FrontendOnly
$DeployFrontend = -not $BackendOnly

function Write-Step($Message) { Write-Host "[=>] $Message" -ForegroundColor Cyan }
function Write-Ok($Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warn($Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Fail($Message) { Write-Host "[FAIL] $Message" -ForegroundColor Red }

function Invoke-Checked($Description, [scriptblock]$Command) {
    Write-Step $Description
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE"
    }
}

function Invoke-Remote([string]$Command) {
    ssh -i $SSH_KEY -o StrictHostKeyChecking=no $REMOTE $Command
}

function Copy-ToRemote([string]$LocalPath, [string]$RemotePath) {
    scp -i $SSH_KEY -o StrictHostKeyChecking=no $LocalPath "${REMOTE}:$RemotePath"
}

function Get-HttpStatus([string]$Url) {
    return Invoke-Remote "curl -s -o /dev/null -w '%{http_code}' $Url"
}

function Get-FrontendEntryAsset() {
    $indexHtml = Invoke-Remote "cat $SERVER_PATH/frontend/dist/index.html"
    $match = [regex]::Match(($indexHtml -join "`n"), 'src="/(assets/index-[^"]+\.js)"')
    if (-not $match.Success) {
        throw "Could not find frontend entry asset in deployed index.html"
    }
    return $match.Groups[1].Value
}

function Assert-HttpStatus([string]$Name, [string]$Url, [string]$Expected = "200") {
    $status = ((Get-HttpStatus $Url) -join "").Trim()
    if ($status -ne $Expected) {
        throw "$Name returned HTTP $status, expected $Expected"
    }
    Write-Ok "$Name HTTP $Expected"
}

function Show-Diagnostics() {
    Write-Warn "Container status:"
    Invoke-Remote "cd $SERVER_PATH && docker compose ps backend ai-worker grading-worker"
    Write-Warn "Recent backend/worker logs:"
    Invoke-Remote "cd $SERVER_PATH && docker compose logs --tail=80 backend ai-worker grading-worker"
    Write-Warn "Backend rollback image: $RollbackImage"
    Write-Warn "Frontend rollback index backup: $RollbackIndex"
    Write-Warn "Backend rollback command:"
    Write-Host "ssh -i `"$SSH_KEY`" -o StrictHostKeyChecking=no $REMOTE `"docker tag $RollbackImage cothink-backend:latest && cd $SERVER_PATH && docker compose up -d backend ai-worker grading-worker`""
    Write-Warn "Frontend rollback command:"
    Write-Host "ssh -i `"$SSH_KEY`" -o StrictHostKeyChecking=no $REMOTE `"cp $RollbackIndex $SERVER_PATH/frontend/dist/index.html`""
}

function Test-Smoke {
    Write-Step "Running smoke checks"
    Assert-HttpStatus "frontend home" "http://localhost/"
    $entryAsset = Get-FrontendEntryAsset
    Assert-HttpStatus "frontend entry asset $entryAsset" "http://localhost/$entryAsset"
    Assert-HttpStatus "backend healthz" "http://localhost:8000/healthz"
    Assert-HttpStatus "learning-space-design meta" "http://localhost/learning-space-design/meta"

    $psOutput = Invoke-Remote "cd $SERVER_PATH && docker compose ps backend ai-worker grading-worker"
    $psText = $psOutput -join "`n"
    foreach ($service in @("cothink-backend", "cothink-ai-worker", "cothink-grading-worker")) {
        if ($psText -notmatch $service -or $psText -notmatch "Up") {
            throw "$service is not running"
        }
    }
    Write-Ok "backend and worker containers are running"

    $logs = Invoke-Remote "cd $SERVER_PATH && docker compose logs --since=2m backend ai-worker grading-worker"
    $logText = $logs -join "`n"
    if ($logText -match "Traceback|ERROR|alembic.*(failed|error)|migration.*(failed|error)") {
        throw "Recent logs contain startup or migration errors"
    }
    Write-Ok "recent backend/worker logs look clean"
}

function Build-Frontend {
    if ($SkipBuild) {
        Write-Warn "Skipping frontend build"
        return
    }
    Push-Location "$ProjectRoot\frontend"
    try {
        Invoke-Checked "Building frontend" { cmd /c npm run build }
    }
    finally {
        Pop-Location
    }
}

function Publish-Frontend {
    Build-Frontend
    $distPath = "$ProjectRoot\frontend\dist"
    $indexPath = "$distPath\index.html"
    $assetsPath = "$distPath\assets"
    if (-not (Test-Path $indexPath) -or -not (Test-Path $assetsPath)) {
        throw "frontend/dist is missing index.html or assets"
    }

    $assetsArchive = Join-Path $env:TEMP "cothink_frontend_assets_$Timestamp.tar.gz"
    try {
        Invoke-Checked "Packing frontend assets" {
            tar -czf $assetsArchive -C $distPath assets
        }
        Invoke-Checked "Uploading frontend assets" {
            Copy-ToRemote $assetsArchive "/tmp/cothink_frontend_assets_$Timestamp.tar.gz"
        }
        Invoke-Checked "Uploading frontend index" {
            Copy-ToRemote $indexPath "/tmp/cothink_index_$Timestamp.html"
        }
        Invoke-Checked "Extracting frontend assets without deleting old hashes" {
            Invoke-Remote "mkdir -p $SERVER_PATH/frontend/dist && cd $SERVER_PATH/frontend/dist && tar -xzf /tmp/cothink_frontend_assets_$Timestamp.tar.gz"
        }
        Invoke-Checked "Swapping frontend index.html last" {
            Invoke-Remote "if [ -f $SERVER_PATH/frontend/dist/index.html ]; then cp $SERVER_PATH/frontend/dist/index.html $RollbackIndex; fi && cp /tmp/cothink_index_$Timestamp.html $SERVER_PATH/frontend/dist/index.html"
        }
        Write-Ok "Frontend published; old hashed assets were preserved"
    }
    finally {
        Remove-Item $assetsArchive -ErrorAction SilentlyContinue
    }
}

function Publish-Backend {
    $backendArchive = Join-Path $env:TEMP "cothink_backend_$Timestamp.tar.gz"
    try {
        Invoke-Checked "Packing backend" {
            tar -czf $backendArchive -C "$ProjectRoot\backend" app alembic scripts alembic.ini requirements.txt pyproject.toml Dockerfile nginx.conf
        }
        Invoke-Checked "Uploading backend package" {
            Copy-ToRemote $backendArchive "/tmp/cothink_backend_$Timestamp.tar.gz"
        }
        Invoke-Checked "Tagging rollback image $RollbackImage" {
            Invoke-Remote "cd $SERVER_PATH && docker image tag cothink-backend:latest $RollbackImage"
        }
        Invoke-Checked "Extracting backend package" {
            Invoke-Remote "tar -xzf /tmp/cothink_backend_$Timestamp.tar.gz -C $SERVER_PATH/backend"
        }
        Invoke-Checked "Building backend image" {
            Invoke-Remote "cd $SERVER_PATH && docker compose build backend"
        }
        Invoke-Checked "Checking Alembic current revision" {
            Invoke-Remote "cd $SERVER_PATH && docker compose run --rm backend alembic current"
        }
        if ($NoMigrate) {
            Write-Warn "Skipping alembic upgrade head"
        }
        else {
            Invoke-Checked "Running Alembic upgrade head" {
                Invoke-Remote "cd $SERVER_PATH && docker compose run --rm backend alembic upgrade head"
            }
        }
        Invoke-Checked "Restarting backend and workers" {
            Invoke-Remote "cd $SERVER_PATH && docker compose up -d backend ai-worker grading-worker"
        }
        Write-Ok "Backend published; rollback image is $RollbackImage"
    }
    finally {
        Remove-Item $backendArchive -ErrorAction SilentlyContinue
    }
}

if ($Help) {
    Get-Help $MyInvocation.MyCommand.Definition -Detailed
    exit 0
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  CoThink AI low-impact deploy" -ForegroundColor Yellow
Write-Host "  Target: ${REMOTE}:$SERVER_PATH" -ForegroundColor Yellow
Write-Host "  Timestamp: $Timestamp" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

try {
    Invoke-Checked "Checking SSH connectivity" {
        ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10 $REMOTE "echo OK"
    }

    if ($SmokeOnly) {
        Test-Smoke
        Write-Ok "Smoke checks passed"
        exit 0
    }

    if ($DeployBackend) {
        Publish-Backend
    }
    if ($DeployFrontend) {
        Publish-Frontend
    }

    Start-Sleep -Seconds 8
    Test-Smoke
    Write-Ok "Deployment complete"
}
catch {
    Write-Fail $_.Exception.Message
    Show-Diagnostics
    exit 1
}
