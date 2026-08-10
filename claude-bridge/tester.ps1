# ============================================================
# tester.ps1 - Test A VIDE de la chaine de livraison de staffing
# Aucun commit sur main/preprod, aucune CI, aucun deploiement.
# A poser dans le dossier claude-bridge du poste, a cote d'un bundle.
# ============================================================

$ErrorCount = 0
function Etape($nom, $ok) {
    if ($ok) { Write-Host "[OK]    $nom" -ForegroundColor Green }
    else { Write-Host "[ECHEC] $nom" -ForegroundColor Red ; $script:ErrorCount++ }
}

$bundle = Get-ChildItem -Path $PSScriptRoot -Filter "staffing-*.bundle" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $bundle) {
    Write-Host "Aucun bundle staffing-*.bundle dans $PSScriptRoot" -ForegroundColor Red
    Read-Host "Entree pour fermer" ; exit 1
}
Write-Host "Bundle : $($bundle.Name)" -ForegroundColor Cyan

$tmp = Join-Path $env:TEMP ("claude-test-livraison-" + (Get-Date -Format "HHmmss"))
git clone --quiet https://github.com/SMALL-conseil/staffing.git $tmp
Etape "Clone du repo GitHub en dossier temporaire (lecture + identifiants)" ($LASTEXITCODE -eq 0)
if ($LASTEXITCODE -ne 0) { Read-Host "Entree pour fermer" ; exit 1 }
Set-Location $tmp

git fetch $bundle.FullName "refs/heads/*:refs/remotes/claude/*"
Etape "Lecture du bundle de livraison" ($LASTEXITCODE -eq 0)

git push --dry-run origin refs/remotes/claude/main:refs/heads/main
Etape "Push main accepte par GitHub (dry-run, rien applique)" ($LASTEXITCODE -eq 0)

git push --quiet origin refs/remotes/claude/main:refs/heads/claude-test-livraison
Etape "Push REEL sur la branche jetable claude-test-livraison" ($LASTEXITCODE -eq 0)
git push --quiet origin --delete claude-test-livraison
Etape "Suppression de la branche jetable" ($LASTEXITCODE -eq 0)

Set-Location $PSScriptRoot
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Etape "Nettoyage du dossier temporaire" (-not (Test-Path $tmp))

Write-Host ""
if ($ErrorCount -eq 0) {
    Write-Host "TEST A VIDE REUSSI - la chaine de livraison est validee." -ForegroundColor Green
} else {
    Write-Host "$ErrorCount etape(s) en echec - copiez toute la sortie a Claude." -ForegroundColor Red
}
Read-Host "Entree pour fermer"
