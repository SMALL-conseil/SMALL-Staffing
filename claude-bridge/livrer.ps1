# ============================================================
# livrer.ps1 - Livraison staffing (bundle Claude -> GitHub)
# A poser dans le dossier claude-bridge du poste (ex. C:\Dev\claude-bridge).
# Merge le bundle depose par Claude dans main + preprod, pousse,
# la CI deploie la preprod. Ne cree JAMAIS de tag v* (prod = geste humain).
# ============================================================

$candidats = @(
    "C:\Dev\staffing-app",
    "C:\Dev\staffing"
)
$repo = $candidats | Where-Object { Test-Path (Join-Path $_ ".git") } | Select-Object -First 1
if (-not $repo) {
    Write-Host "Aucun clone du repo trouve sur ce poste (attendu : C:\Dev\staffing)." -ForegroundColor Red
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

git checkout preprod
if ($LASTEXITCODE -ne 0) { git checkout -b preprod origin/preprod }
if ($LASTEXITCODE -ne 0) { git checkout -b preprod }
git pull origin preprod 2>$null
git merge --no-edit claude/preprod
if ($LASTEXITCODE -ne 0) { Write-Host "Echec du merge preprod (main est deja pousse)" -ForegroundColor Red ; git checkout main ; Read-Host "Entree pour fermer" ; exit 1 }
git push -u origin preprod
if ($LASTEXITCODE -ne 0) { Write-Host "Echec du push preprod" -ForegroundColor Red ; git checkout main ; Read-Host "Entree pour fermer" ; exit 1 }
git checkout main

$done = Join-Path $PSScriptRoot "_done"
if (-not (Test-Path $done)) { New-Item -ItemType Directory -Path $done | Out-Null }
Move-Item $bundle.FullName (Join-Path $done $bundle.Name) -Force

Write-Host ""
Write-Host "Livraison poussee : main + preprod." -ForegroundColor Green
Write-Host "La CI deploie la preprod (~5-10 min). Dites a Claude : verifie la livraison." -ForegroundColor Green
Read-Host "Entree pour fermer"
