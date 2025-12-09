:: Shutdown all instance of cmd (execpt this one) and KisokBrowser
CD /D "C:\washStationProject"

:: Connect to ftp server
SET OUTPUTFILE=ftp-output.txt
SET ERRORFILE=ftp-output-error.txt
ftp.exe -s:ftp-config-update.txt >"%OUTPUTFILE%" 2>"%ERRORFILE%"

if  ERRORLEVEL 1 (
    echo Call to ftp returned an error. See file: %OUTPUTFILE%
	shutdown.exe /r /t 00
    exit /b 1
)

FOR /F "usebackq" %%A IN ('%ERRORFILE%') DO set ERRORFILESIZE=%%~zA
if %ERRORFILESIZE% GTR 0 ( 
    echo Error while performing the FTP. See file: %ERRORFILE%
	shutdown.exe /r /t 00
    exit /b 2
)

:: Make vm backup
xcopy /s .\lma-vm-app-0117 .\lma-vm-app-0117.backup\ /I /Y
RD /s /q ".\lma-vm-app-0117"

:: Unzip (lma-vm-app-0117.zip).
powershell.exe -nologo -noprofile -command "& { Add-Type -A 'System.IO.Compression.FileSystem'; [IO.Compression.ZipFile]::ExtractToDirectory('lma-vm-app-0117.zip', '.'); }"

:: Delete all .zip file and git related files.
DEL *.zip
RD /S /Q ".\lma-vm-app-0117\.git"

shutdown.exe /r /t 00