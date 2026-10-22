@echo off
title AI Shorts Studio - Akses HP
color 0A

echo =========================================================================
echo                   AI SHORTS STUDIO - AKSES DARI HP
echo =========================================================================
echo.

cd /d "%~dp0"

rem Cek apakah server dev sudah aktif di port 5173
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul
if %errorlevel% neq 0 (
    echo [1/2] Server belum berjalan. Memulai server...
    start "AI Shorts Studio Server" cmd /k "call start.bat"
    echo       Menunggu server siap...
    :wait_loop
    timeout /t 2 /nobreak >nul
    netstat -ano | findstr ":5173" | findstr "LISTENING" >nul
    if %errorlevel% neq 0 goto wait_loop
    echo       Server siap!
) else (
    echo [1/2] Server sudah berjalan di port 5173.
)

echo.
echo [2/2] Membuka Cloudflare Tunnel...
echo.
echo =========================================================================
echo  PETUNJUK AKSES HP:
echo  1. Cari baris link: https://xxxx.trycloudflare.com di bawah ini.
echo  2. Buka link itu di Google Chrome / Safari HP lu.
echo  3. Klik menu titik tiga di Chrome ^> "Install Aplikasi" / "Tambahkan ke Layar Utama".
echo  4. Web akan langsung terpasang jadi APLIKASI di HP lu!
echo =========================================================================
echo.

"%~dp0bin\cloudflared.exe" tunnel --url http://localhost:5173
