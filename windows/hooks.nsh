; Ganchos do instalador NSIS (Tauri 2).
; Depois de instalar/atualizar, força o Windows a recarregar os ícones — sem isso, o atalho da
; área de trabalho continua mostrando o ícone antigo (cache de ícones do Explorer).
!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$SYSDIR\ie4uinit.exe" 0 +2
    nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
  ; SHCNE_ASSOCCHANGED: o Explorer redesenha atalhos e ícones
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
