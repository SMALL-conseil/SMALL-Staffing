# ============================================================
# exporter-tjm.ps1 - Genere le tableau Excel des TJM et l'OUVRE.
# Double-clic : lance scripts/export-tjm.ts dans le repo staffing,
# puis ouvre exports\TJM_Boond_<date>.xlsx dans Excel.
# Contenu : consultants avec TJM fiche Boond (missions en cours, TJM
# effectif, jours CRA), consultants sans TJM fiche, et l'historique
# complet des missions passees avec leur TJM et leur CA reel estime.
# ============================================================

$candidats = @(
    "C:\Dev\staffing-app",
    "C:\Dev\staffing"
)
$repo = $candidats | Where-Object { Test-Path (Join-Path $_ "scripts\export-tjm.ts") } | Select-Object -First 1
if (-not $repo) {
    Write-Host "Aucun clone du repo trouve sur ce poste (attendu : C:\Dev\staffing-app)." -ForegroundColor Red
    Read-Host "Entree pour fermer" ; exit 1
}
Write-Host "Repo : $repo" -ForegroundColor Cyan
Set-Location $repo

Write-Host "Export en cours..." -ForegroundColor Cyan
npx tsx scripts/export-tjm.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "L'export a echoue (code $LASTEXITCODE) - verifier que la base tourne (npm run dev ou PostgreSQL demarre)." -ForegroundColor Red
    Read-Host "Entree pour fermer" ; exit 1
}

$fichier = Get-ChildItem (Join-Path $repo "exports\TJM_Boond_*.xlsx") |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $fichier) {
    Write-Host "Fichier introuvable dans exports\ - voir les messages ci-dessus." -ForegroundColor Red
    Read-Host "Entree pour fermer" ; exit 1
}

Write-Host "Ouverture : $($fichier.Name)" -ForegroundColor Green
Invoke-Item $fichier.FullName
Start-Sleep -Seconds 2
