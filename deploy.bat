@echo off
echo ==========================================
echo    TAP LENH DEPLOY GITHUB - PHOTOBOOTH
echo ==========================================
echo.

:: Kiem tra neu chua co thu muc .git thi khoi tao
if not exist ".git" (
    echo [1/4] Khoi tao Git repository...
    git init
    git branch -M main
    git remote add origin https://github.com/lwd7071/ptb.git
) else (
    echo [1/4] Git repository da ton tai.
)

echo.
echo [2/4] Them tat ca cac file vao commit...
git add .

echo.
echo [3/4] Tao commit moi...
git commit -m "Deploy Photobooth - %date% %time%"

echo.
echo [4/4] Day code len GitHub (origin main)...
git push -u origin main

echo.
echo ==========================================
echo HOAN THANH! Code da duoc dua len GitHub.
echo.
echo De bat GitHub Pages, ban hay lam theo huong dan:
echo 1. Vao link: https://github.com/lwd7071/ptb/settings/pages
echo 2. O muc "Source", chon "Deploy from a branch"
echo 3. O muc "Branch", chon "main" va "/ (root)", roi bam Save.
echo 4. Cho khoang 1-2 phut la trang web se hoat dong!
echo ==========================================
pause
