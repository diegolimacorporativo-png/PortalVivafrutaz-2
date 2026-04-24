#!/bin/bash
# VivaFrutaz E2E Tests — Playwright
# Requer: LIBPATH configurado (libgbm + libasound do nix store)

export LD_LIBRARY_PATH="/nix/store/24w3s75aa2lrvvxsybficn8y3zxd27kp-mesa-libgbm-25.1.0/lib:/nix/store/0g7r7krqiz6g3nb3651sfa5myd9gqkzf-alsa-lib-1.2.11/lib:${LD_LIBRARY_PATH:-}"

echo "==================================="
echo " VivaFrutaz E2E Tests"
echo " Vídeos: tests/videos/"
echo " Relatório: tests/reports/index.html"
echo "==================================="

npx playwright test "$@"

STATUS=$?
echo ""
echo "==================================="
if [ $STATUS -eq 0 ]; then
  echo " Todos os testes PASSARAM!"
else
  echo " Alguns testes falharam. Verifique os vídeos e relatório."
fi
echo "==================================="
exit $STATUS
