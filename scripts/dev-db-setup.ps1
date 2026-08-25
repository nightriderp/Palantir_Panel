<#
.SYNOPSIS
    Legt Rolle und Datenbank "palantir" auf einer lokalen PostgreSQL-Instanz an
    und traegt die Zugangsdaten konsistent in die .env ein.

.DESCRIPTION
    NUR FUER DIE LOKALE ENTWICKLUNGSUMGEBUNG.

    Auf VPS und Homeserver laeuft PostgreSQL laut Pflichtenheft §3 im Container;
    dort wird die Datenbank ueber docker-compose bereitgestellt und nicht ueber
    dieses Skript. Die Vorgehensweise fuer Produktion steht in SETUP.md.

    Das Skript:
      1. sucht psql.exe
      2. erzeugt ein zufaelliges Passwort fuer die Rolle "palantir"
      3. legt Rolle und Datenbank an (idempotent - mehrfaches Ausfuehren ist ok)
      4. schreibt POSTGRES_PASSWORD und DATABASE_URL konsistent in die .env
      5. prueft die Verbindung mit den neuen Zugangsdaten

    Beim Anlegen fragt psql einmal nach dem Passwort des postgres-Superusers.
    Dieses Skript speichert dieses Passwort nirgends.

.EXAMPLE
    .\scripts\dev-db-setup.ps1

.EXAMPLE
    .\scripts\dev-db-setup.ps1 -PsqlPath "C:\Program Files\PostgreSQL\18\bin\psql.exe"
#>

[CmdletBinding()]
param(
    [string]$PsqlPath,
    [string]$DbHost = '127.0.0.1',
    [int]$Port = 5432,
    [string]$DbName = 'palantir',
    [string]$DbUser = 'palantir',
    [string]$SuperUser = 'postgres'
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$m) Write-Host "[setup] $m" -ForegroundColor Cyan }
function Write-Ok { param([string]$m) Write-Host "[ ok ] $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "[warn] $m" -ForegroundColor Yellow }

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env'

# --- 1. psql finden ---------------------------------------------------------

if (-not $PsqlPath) {
    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($cmd) {
        $PsqlPath = $cmd.Source
    }
    else {
        # Die Server-Installation unter <version>\bin bevorzugen - unter
        # "pgAdmin 4\runtime" liegt eine zweite psql.exe, die hier nicht gemeint ist.
        $kandidaten = Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter psql.exe -ErrorAction SilentlyContinue
        $found = $kandidaten | Where-Object { $_.FullName -match '\\\d+\\bin\\psql\.exe$' } |
            Sort-Object FullName -Descending | Select-Object -First 1
        if (-not $found) { $found = $kandidaten | Sort-Object FullName -Descending | Select-Object -First 1 }
        if ($found) { $PsqlPath = $found.FullName }
    }
}

if (-not $PsqlPath -or -not (Test-Path $PsqlPath)) {
    throw "psql.exe nicht gefunden. Pfad per -PsqlPath uebergeben."
}
Write-Ok "psql gefunden: $PsqlPath"

if (-not (Test-Path $envFile)) {
    throw ".env nicht gefunden unter $envFile - zuerst scripts/setup.sh ausfuehren (oder .env.example kopieren)."
}

# --- 2. Passwort erzeugen ---------------------------------------------------
# Bewusst nur alphanumerisch: das Passwort landet in DATABASE_URL und muesste
# sonst URL-kodiert werden.

$alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
$bytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
Write-Ok 'Zufaelliges Passwort fuer die Rolle erzeugt'

# --- 3. Rolle und Datenbank anlegen ----------------------------------------

$sqlEscapedPassword = $password -replace "'", "''"
$sql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DbUser') THEN
    CREATE ROLE $DbUser LOGIN PASSWORD '$sqlEscapedPassword';
  ELSE
    ALTER ROLE $DbUser WITH LOGIN PASSWORD '$sqlEscapedPassword';
  END IF;
END
`$`$;
SELECT 'CREATE DATABASE $DbName OWNER $DbUser'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DbName')\gexec
"@

$sqlFile = Join-Path ([System.IO.Path]::GetTempPath()) "palantir-db-$([guid]::NewGuid().ToString('N')).sql"
[System.IO.File]::WriteAllText($sqlFile, $sql, (New-Object System.Text.UTF8Encoding($false)))

try {
    Write-Step "Lege Rolle und Datenbank an - psql fragt jetzt nach dem Passwort von '$SuperUser'."
    & $PsqlPath -U $SuperUser -h $DbHost -p $Port -d postgres -v ON_ERROR_STOP=1 -f $sqlFile
    if ($LASTEXITCODE -ne 0) {
        throw "psql ist mit Exit-Code $LASTEXITCODE fehlgeschlagen. Rolle/Datenbank wurden nicht angelegt."
    }
    Write-Ok "Rolle '$DbUser' und Datenbank '$DbName' vorhanden"
}
finally {
    Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue
}

# --- 4. .env schreiben ------------------------------------------------------
# POSTGRES_PASSWORD und DATABASE_URL muessen denselben Wert tragen - genau der
# Punkt, den scripts/setup.sh bewusst offen laesst.

$databaseUrl = "postgresql://${DbUser}:${password}@${DbHost}:${Port}/${DbName}"

$lines = [System.IO.File]::ReadAllLines($envFile)
$neu = foreach ($line in $lines) {
    if ($line -match '^POSTGRES_PASSWORD=') { "POSTGRES_PASSWORD=$password" }
    elseif ($line -match '^POSTGRES_USER=') { "POSTGRES_USER=$DbUser" }
    elseif ($line -match '^POSTGRES_DB=') { "POSTGRES_DB=$DbName" }
    elseif ($line -match '^DATABASE_URL=') { "DATABASE_URL=$databaseUrl" }
    else { $line }
}
[System.IO.File]::WriteAllLines($envFile, $neu, (New-Object System.Text.UTF8Encoding($false)))
Write-Ok '.env aktualisiert (POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, DATABASE_URL)'

# --- 5. Verbindung pruefen --------------------------------------------------

Write-Step 'Pruefe Verbindung mit den neuen Zugangsdaten ...'
$env:PGPASSWORD = $password
try {
    $result = & $PsqlPath -U $DbUser -h $DbHost -p $Port -d $DbName -t -A -c "SELECT current_database() || ' / ' || current_user;"
    if ($LASTEXITCODE -ne 0) { throw "Verbindungstest fehlgeschlagen (Exit-Code $LASTEXITCODE)." }
    Write-Ok "Verbindung erfolgreich: $($result.Trim())"
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Ok 'Datenbank bereit. Naechster Schritt: Arbeitspaket F0 (Drizzle-Setup) starten.'
Write-Warn 'Das Passwort steht ausschliesslich in der .env. Diese Datei gehoert nicht ins Repository.'
