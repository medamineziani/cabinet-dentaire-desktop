@echo off
rem Lance l'application depuis le code source. Au cabinet, utiliser plutot l'installateur.
cd /d "%~dp0"
if not exist node_modules (
  call npm install || goto erreur
)
if not exist src\main\db\generated (
  call npm run db:generate || goto erreur
)
call npm run dev
goto :eof
:erreur
echo Installation impossible : verifiez que Node.js est installe.
pause
