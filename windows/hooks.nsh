; Ganchos do instalador NSIS (Tauri 2).
; Depois de instalar/atualizar, força o Windows a recarregar os ícones — sem isso, o atalho da
; área de trabalho continua mostrando o ícone antigo (cache de ícones do Explorer).
!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$SYSDIR\ie4uinit.exe" 0 +2
    nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
  ; SHCNE_ASSOCCHANGED: o Explorer redesenha atalhos e ícones
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

; Copia automaticamente o instalador gerado pelo `cargo tauri build` para a pasta `instaladores/`.
!finalize `powershell -NoProfile -ExecutionPolicy Bypass -Command "$src = (Resolve-Path '%1').Path; $arch = Split-Path -Leaf (Get-Location); $d = (Get-Location).Path; while ($d -and -not (Test-Path (Join-Path $d 'tauri.conf.json'))) { $d = Split-Path -Parent $d }; if ($d) { $cfg = Get-Content (Join-Path $d 'tauri.conf.json') -Raw | ConvertFrom-Json; $dest = Join-Path $d 'instaladores'; New-Item -ItemType Directory -Force $dest | Out-Null; $name = '{0}_{1}_{2}-setup.exe' -f $cfg.productName, $cfg.version, $arch; Copy-Item -Force $src (Join-Path $dest $name) }"`
