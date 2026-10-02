$ErrorActionPreference = "Stop"

function Invoke-WranglerJson {
    param (
        [Parameter(Mandatory = $true)]
        [string[]]$WranglerArgs
    )

    $output = & wrangler @WranglerArgs 2>$null

    if ($LASTEXITCODE -ne 0) {
        throw "Wrangler command failed: wrangler $($WranglerArgs -join ' ')"
    }

    $text = ($output -join "`n").Trim()

    if ([string]::IsNullOrWhiteSpace($text)) {
        throw "Wrangler returned empty output."
    }

    try {
        return $text | ConvertFrom-Json
    }
    catch {
        throw "Failed to parse Wrangler JSON output:`n$text"
    }
}

function Invoke-CloudflareGet {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Uri,

        [Parameter(Mandatory = $true)]
        [hashtable]$Headers
    )

    return Invoke-RestMethod `
        -Method Get `
        -Uri $Uri `
        -Headers $Headers
}

Write-Host "Checking Wrangler..." -ForegroundColor Cyan

if (-not (Get-Command wrangler -ErrorAction SilentlyContinue)) {
    throw "wrangler was not found in PATH."
}

# ------------------------------------------------------------
# 1. Get Cloudflare accounts from the current Wrangler login
# ------------------------------------------------------------

Write-Host "Reading Cloudflare account information..." -ForegroundColor Cyan

try {
    $whoami = Invoke-WranglerJson -WranglerArgs @("whoami", "--json")
}
catch {
    throw @"
Unable to read Wrangler account information.

Make sure you are logged in:

    wrangler login

Then try again.

Original error:
$($_.Exception.Message)
"@
}

$accounts = @($whoami.accounts)

if ($accounts.Count -eq 0) {
    throw "No Cloudflare accounts were returned by 'wrangler whoami --json'."
}

Write-Host "Found $($accounts.Count) account(s)." -ForegroundColor Green

# ------------------------------------------------------------
# 2. Get the current Wrangler authentication credentials
# ------------------------------------------------------------

Write-Host "Reading Wrangler authentication token..." -ForegroundColor Cyan

try {
    $auth = Invoke-WranglerJson -WranglerArgs @("auth", "token", "--json")
}
catch {
    throw @"
Unable to retrieve the Wrangler authentication token.

Your Wrangler version may be too old.

Check:

    wrangler --version

Update if necessary:

    npm install -g wrangler@latest

Original error:
$($_.Exception.Message)
"@
}

$headers = @{}

switch ($auth.type) {
    "oauth" {
        $headers["Authorization"] = "Bearer $($auth.token)"
    }

    "api_token" {
        $headers["Authorization"] = "Bearer $($auth.token)"
    }

    "api_key" {
        $headers["X-Auth-Email"] = $auth.email
        $headers["X-Auth-Key"]   = $auth.key
    }

    default {
        throw "Unsupported Wrangler authentication type: $($auth.type)"
    }
}

# ------------------------------------------------------------
# 3. Enumerate Workers and query Cron Triggers
# ------------------------------------------------------------

$results = @()
$grandTotalWorkers = 0
$grandTotalCrons = 0

foreach ($account in $accounts) {

    $accountId   = $account.id
    $accountName = $account.name

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor DarkGray
    Write-Host "Account: $accountName" -ForegroundColor Yellow
    Write-Host "ID:      $accountId" -ForegroundColor DarkGray
    Write-Host "============================================================" -ForegroundColor DarkGray

    $workersUri = "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts"

    try {
        $workerResponse = Invoke-CloudflareGet `
            -Uri $workersUri `
            -Headers $headers
    }
    catch {
        Write-Warning "Unable to list Workers for account '$accountName'."
        Write-Warning $_.Exception.Message
        continue
    }

    $workers = @($workerResponse.result)

    if ($workers.Count -eq 0) {
        Write-Host "No Workers found." -ForegroundColor DarkGray
        continue
    }

    Write-Host "Workers found: $($workers.Count)"
    Write-Host "Checking Cron Triggers..."

    $accountCronWorkers = 0
    $accountCronCount = 0

    foreach ($worker in $workers) {

        $workerName = [string]$worker.id
        $escapedWorkerName = [Uri]::EscapeDataString($workerName)

        $scheduleUri = "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/$escapedWorkerName/schedules"

        try {
            $scheduleResponse = Invoke-CloudflareGet `
                -Uri $scheduleUri `
                -Headers $headers
        }
        catch {
            Write-Warning "Failed to query Cron Triggers for Worker '$workerName'."
            continue
        }

        # Current Cloudflare API:
        # result.schedules = [...]
        #
        # Also tolerate the older result = [...] format.

        if ($null -ne $scheduleResponse.result.schedules) {
            $schedules = @($scheduleResponse.result.schedules)
        }
        else {
            $schedules = @($scheduleResponse.result)
        }

        $validSchedules = @(
            $schedules | Where-Object {
                $null -ne $_ -and
                -not [string]::IsNullOrWhiteSpace([string]$_.cron)
            }
        )

        if ($validSchedules.Count -gt 0) {

            $accountCronWorkers++
            $accountCronCount += $validSchedules.Count

            $cronStrings = @(
                $validSchedules | ForEach-Object {
                    [string]$_.cron
                }
            )

            $results += [PSCustomObject]@{
                Account     = $accountName
                Worker      = $workerName
                CronCount   = $validSchedules.Count
                Cron        = ($cronStrings -join " ; ")
            }

            Write-Host ""
            Write-Host "  [CRON] $workerName" -ForegroundColor Green

            foreach ($cron in $cronStrings) {
                Write-Host "         $cron" -ForegroundColor Cyan
            }
        }
    }

    $grandTotalWorkers += $accountCronWorkers
    $grandTotalCrons += $accountCronCount

    Write-Host ""
    Write-Host "Account summary:" -ForegroundColor Yellow
    Write-Host "  Workers with Cron : $accountCronWorkers"
    Write-Host "  Cron Triggers      : $accountCronCount"
}

# ------------------------------------------------------------
# 4. Final summary
# ------------------------------------------------------------

Write-Host ""
Write-Host "============================================================" -ForegroundColor DarkGray
Write-Host "FINAL SUMMARY" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor DarkGray

if ($results.Count -eq 0) {

    Write-Host "No Workers with Cron Triggers were found." -ForegroundColor Green

}
else {

    $results |
        Sort-Object Account, Worker |
        Format-Table -AutoSize

    Write-Host ""
    Write-Host "Workers with Cron : $grandTotalWorkers" -ForegroundColor Yellow
    Write-Host "Total Cron Triggers: $grandTotalCrons" -ForegroundColor Yellow
}

Write-Host ""