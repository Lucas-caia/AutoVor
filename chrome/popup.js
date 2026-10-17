'use strict';
const button = document.getElementById('toggle');
let enabled = false;
let busy = false;
async function send(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error || 'Conexão indisponível.');
  return reply.result;
}
function show(status) {
  enabled = status.enabled;
  document.getElementById('status').textContent = status.error ? 'Precisa da sua atenção' : enabled ? 'Automação em andamento' : 'Pronto para começar';
  document.getElementById('indicator').className = `dot ${status.error ? 'warning' : enabled ? 'active' : ''}`;
  document.getElementById('detail').textContent = status.error || (status.job ? `Mod ${status.job.identity.mod} · arquivo ${status.job.identity.file}` : enabled ? 'Aguardando o próximo mod da coleção no Vortex.' : 'Inicie uma coleção no Vortex e ative a automação.');
  document.getElementById('count').textContent = status.completed;
  button.textContent = enabled ? 'Pausar automação' : 'Iniciar automação';
  button.className = enabled ? 'pause' : '';
  button.disabled = busy;
  document.getElementById('error').hidden = true;
}
async function refresh() {
  if (busy) return;
  try { show(await send({ type: 'status' })); }
  catch {
    document.getElementById('status').textContent = 'Vortex não conectado';
    document.getElementById('detail').textContent = 'Instale a extensão do Vortex e reinicie o aplicativo. Depois abra este painel novamente.';
    button.disabled = true;
  }
}
button.addEventListener('click', async () => {
  busy = true; button.disabled = true;
  try { const result = await send({ type: 'control', enabled: !enabled }); busy = false; show(result); }
  catch (err) { busy = false; document.getElementById('error').textContent = err.message; document.getElementById('error').hidden = false; button.disabled = false; }
});
refresh();
setInterval(refresh, 1500);
