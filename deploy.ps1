# =============================================================================
# deploy.ps1 - Student Pass Fail System Complete Deployment Script
# =============================================================================

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Student Pass Fail System - Full Deploy" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------
# Step 1: Build Frontend
# ---------------------------------------------------------------
Write-Host ">> Step 1/3: Building Frontend (Vite)..." -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host ">> Frontend Build Failed!" -ForegroundColor Red
    exit 1
}
Write-Host ">> Frontend Build Successful!" -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------
# Step 2: Push to GitHub (Triggers Render Backend Deploy)
# ---------------------------------------------------------------
Write-Host ">> Step 2/3: Pushing to GitHub..." -ForegroundColor Cyan
git add .
git commit -m "Deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>$null
git push origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host ">> Git Push Failed!" -ForegroundColor Red
    exit 1
}
Write-Host ">> Git Push Successful! (Render will auto-deploy backend)" -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------
# Step 3: Deploy Frontend to Firebase Hosting
# ---------------------------------------------------------------
Write-Host ">> Step 3/3: Deploying to Firebase Hosting..." -ForegroundColor Cyan
firebase deploy --only hosting

if ($LASTEXITCODE -ne 0) {
    Write-Host ">> Firebase Deployment Failed!" -ForegroundColor Red
    exit 1
}
Write-Host ">> Firebase Deployment Successful!" -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------
# Final Success
# ---------------------------------------------------------------
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Frontend: https://veromedphm.web.app" -ForegroundColor Yellow
Write-Host "  Backend:  https://veromed-feap.onrender.com" -ForegroundColor Yellow
Write-Host "  Note: Render auto-deploys backend from GitHub push." -ForegroundColor Yellow
Write-Host ""
Write-Host "  All done! Your Student Pass Fail System is live." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
