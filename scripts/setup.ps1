# One-shot setup for Windows (PowerShell 5.1+ or 7).
#   .\scripts\setup.ps1 -Mode cloudflare   deploy to Cloudflare Workers + D1 (free plan, no server)
#   .\scripts\setup.ps1 -Mode selfhost     run on this machine or a VPS (local workerd + SQLite, long polling)
param([ValidateSet('cloudflare', 'selfhost')][string]$Mode)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Invoke-Checked([scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE) { throw "Command failed ($LASTEXITCODE): $Command" }
}

if (-not $Mode) {
  $choice = Read-Host 'Run on (1) Cloudflare or (2) this machine / VPS? [1/2]'
  $Mode = if ($choice -eq '2') { 'selfhost' } else { 'cloudflare' }
}

node -e 'const v=process.versions.node.split(/[.]/).map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=18)?0:1)'
if ($LASTEXITCODE) { throw 'Node.js >= 22.18 is required.' }
Invoke-Checked { npm install --no-fund --no-audit }

$secureToken = Read-Host 'Telegram bot token (from @BotFather)' -AsSecureString
$token = [System.Net.NetworkCredential]::new('', $secureToken).Password
$ids = Read-Host 'Allowed Telegram user IDs, owner first, comma-separated (empty: the bot tells you yours)'
$secret = node -p "Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')"

if ($Mode -eq 'cloudflare') {
  if (-not (npx wrangler whoami 2>$null | Select-String 'You are logged in' -Quiet)) { Invoke-Checked { npx wrangler login } }

  $secretsFile = New-TemporaryFile
  try {
    @{ TELEGRAM_BOT_TOKEN = $token; TELEGRAM_WEBHOOK_SECRET = $secret; ALLOWED_TELEGRAM_IDS = $ids } |
      ConvertTo-Json | Set-Content -Path $secretsFile -Encoding ascii
    npx wrangler deploy --secrets-file $secretsFile 2>&1 | Tee-Object -Variable deployOutput | Out-Host
    if ($LASTEXITCODE) { throw 'wrangler deploy failed' }
    $deployLog = $deployOutput -join "`n"
  } finally {
    Remove-Item $secretsFile -Force
  }
  $url = ([regex]'https://[a-zA-Z0-9.-]+\.workers\.dev').Match($deployLog).Value
  if (-not $url) { throw 'Could not find the workers.dev URL in the deploy output.' }

  Invoke-Checked { npm run db:migrate }
  $env:TELEGRAM_BOT_TOKEN = $token; $env:TELEGRAM_WEBHOOK_SECRET = $secret; $env:WORKER_URL = $url
  try { Invoke-Checked { npm run -s set-webhook } }
  finally { Remove-Item Env:TELEGRAM_BOT_TOKEN, Env:TELEGRAM_WEBHOOK_SECRET, Env:WORKER_URL }

  git diff --quiet -- wrangler.jsonc 2>$null
  if ($LASTEXITCODE) {
    Write-Host "Note: wrangler wrote your database_id into wrangler.jsonc. It isn't needed; don't commit it (git checkout wrangler.jsonc)."
  }
  Write-Host "`nDone: $url"
  if (-not $ids) { Write-Host 'Message the bot to get your Telegram ID, then: npx wrangler secret put ALLOWED_TELEGRAM_IDS' }
} else {
  if (Test-Path .dev.vars) {
    if ((Read-Host '.dev.vars exists. Overwrite? [y/N]') -ne 'y') {
      Write-Host 'Keeping .dev.vars.'
      Invoke-Checked { npm run db:migrate:selfhost }
      exit 0
    }
  }
  "TELEGRAM_BOT_TOKEN=$token`nTELEGRAM_WEBHOOK_SECRET=$secret`nALLOWED_TELEGRAM_IDS=$ids`n" |
    Set-Content -Path .dev.vars -Encoding ascii -NoNewline
  # Owner-only access to the secrets file.
  if ($env:OS -eq 'Windows_NT') { icacls .dev.vars /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null }
  else { chmod 600 .dev.vars }
  Invoke-Checked { npm run db:migrate:selfhost }
  Write-Host "`nDone. Start the bot with: npm run selfhost"
  if (-not $ids) { Write-Host 'Message the bot to get your Telegram ID, put it into ALLOWED_TELEGRAM_IDS in .dev.vars, then restart.' }
}
