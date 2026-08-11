# ============================================================
# appliquer-local.ps1 - Applique le bundle Claude en MODE LOCAL D'ABORD.
# Merge le bundle dans main et pousse main UNIQUEMENT : la branche preprod
# n'est pas touchee, donc AUCUN deploiement declenche (la CI « Deploy
# Preprod » n'ecoute que preprod). A utiliser tant que le VPS n'est pas
# greffe / tant qu'on valide les features en local.
# Quand une livraison doit partir en preprod : livrer-staffing.ps1.
# ============================================================

$candidats = @(
    "C:\Dev\staffing-app",
    "C:\Dev\staffing"
)
$repo = $candidats | Where-Object { Test-Path (Join-Path $_ ".git") } | Select-Object -First 1
if (-not $repo) {
    Write-Host "Aucun clone du repo trouve sur ce poste (attendu : C:\Dev\staffing-app)." -ForegroundColor Red
    Read-Host "Entree pour fermer" ; exit 1
}
Write-Host "Repo : $repo" -ForegroundColor Cyan

$bundle = Get-ChildItem -Path $PSScriptRoot -Filter "staffing-*.bundle" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $bundle) {
    Write-Host "Aucun bundle staffing-*.bundle trouve dans $PSScriptRoot" -ForegroundColor Red
    Read-Host "Entree pour fermer" ; exit 1
}
Write-Host "Bundle : $($bundle.Name)" -ForegroundColor Cyan

Set-Location $repo
if (Test-Path .git\index.lock) { Remove-Item .git\index.lock }

git bundle verify $bundle.FullName
if ($LASTEXITCODE -ne 0) { Write-Host "Bundle invalide - rien n'a ete fait" -ForegroundColor Red ; Read-Host "Entree pour fermer" ; exit 1 }
git fetch $bundle.FullName "refs/heads/*:refs/remotes/claude/*"
if ($LASTEXITCODE -ne 0) { Write-Host "Echec du fetch - rien n'a ete pousse" -ForegroundColor Red ; Read-Host "Entree pour fermer" ; exit 1 }

git checkout main
git pull origin main
git merge --no-edit claude/main
if ($LASTEXITCODE -ne 0) { Write-Host "Echec du merge main - rien n'a ete pousse" -ForegroundColor Red ; Read-Host "Entree pour fermer" ; exit 1 }
git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "Echec du push main" -ForegroundColor Red ; Read-Host "Entree pour fermer" ; exit 1 }

$done = Join-Path $PSScriptRoot "_done"
if (-not (Test-Path $done)) { New-Item -ItemType Directory -Path $done | Out-Null }
Move-Item $bundle.FullName (Join-Path $done $bundle.Name) -Force

Write-Host ""
Write-Host "Applique : main est a jour (local + GitHub). Preprod NON touchee." -ForegroundColor Green
Write-Host "Pour tester en local :" -ForegroundColor Green
Write-Host "  npm ci ; npx prisma generate        (si dependances/schema ont change)"
Write-Host "  npx prisma migrate deploy            (si nouvelle migration)"
Write-Host "  npm run dev                          -> http://localhost:3000"
Read-Host "Entree pour fermer"
