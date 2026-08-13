(() => {
  const originalRenderGames = window.renderGames;
  if (typeof originalRenderGames !== 'function' || typeof window.loadAnalysis !== 'function') return;

  window.renderGames = function () {
    originalRenderGames();
    const rows = typeof window.filtered === 'function' ? window.filtered() : (window.state?.games || []);
    for (const g of rows) {
      if (g.provider !== 'sportmonks') continue;
      const match = document.querySelector(`.match[data-id="${CSS.escape(String(g.id))}"]`);
      if (!match) continue;
      let box = match.querySelector('.analysis');
      if (!box) {
        box = document.createElement('div');
        box.className = 'analysis loading';
        box.id = 'analysis-' + g.id;
        box.textContent = '🤖 Calculando Casa • Empate • Fora…';
        match.appendChild(box);
      }
      window.loadAnalysis(String(g.id));
    }
  };

  setTimeout(() => {
    if (typeof window.renderGames === 'function') window.renderGames();
  }, 300);
})();
