// Ponte: lê o chat/presentes da live do TikTok e envia para o jogo (SSE)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebcastPushConnection } = require('tiktok-live-connector');

const PORT = process.env.PORT || 3000;
const SENHA = process.env.SENHA || '';          // opcional: protege /conectar
let usuario = (process.env.TIKTOK_USER || '').replace('@', '');
const clientes = new Set();
let conexao = null;
let estado = 'desconectado';

function enviar(obj) {
  const msg = 'data: ' + JSON.stringify(obj) + '\n\n';
  clientes.forEach((res) => res.write(msg));
}

function conectar(nome) {
  if (conexao) { try { conexao.disconnect(); } catch (e) {} }
  usuario = nome.replace('@', '');
  estado = 'conectando';
  conexao = new WebcastPushConnection(usuario);
  conexao.connect()
    .then(() => { estado = 'conectado a @' + usuario; console.log(estado); })
    .catch((err) => {
      estado = 'erro: ' + (err && err.message ? err.message : err);
      console.error(estado);
      setTimeout(() => usuario && conectar(usuario), 15000); // tenta de novo
    });
  conexao.on('chat', (d) => enviar({ type: 'chat', user: d.uniqueId, text: d.comment }));
  conexao.on('gift', (d) => {
    // presente em sequência só conta ao terminar
    if (d.giftType === 1 && !d.repeatEnd) return;
    enviar({ type: 'gift', user: d.uniqueId });
  });
  conexao.on('streamEnd', () => { estado = 'live encerrada'; });
  conexao.on('disconnected', () => { estado = 'desconectado'; });
}


http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': ok\n\n');
    clientes.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000); // evita o servidor dormir
    req.on('close', () => { clearInterval(ping); clientes.delete(res); });
    return;
  }

  if (url.pathname === '/conectar') {
    if (SENHA && url.searchParams.get('senha') !== SENHA) {
      res.writeHead(403); return res.end('Senha incorreta');
    }
    const nome = url.searchParams.get('usuario');
    if (!nome) { res.writeHead(400); return res.end('Use /conectar?usuario=seu_usuario'); }
    conectar(nome);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Conectando a @' + nome.replace('@', '') + '. Veja /status');
  }

  if (url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(estado + ' | jogos abertos: ' + clientes.size);
  }

  // Teste sem live: /teste?user=Ana&text=!entrar
  if (url.pathname === '/teste') {
    enviar({ type: 'chat', user: url.searchParams.get('user') || 'Teste', text: url.searchParams.get('text') || '!entrar' });
    res.writeHead(200); return res.end('ok');
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(404); return res.end('Não encontrado'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  }
  res.writeHead(404); res.end('Não encontrado');
}).listen(PORT, () => {
  console.log('Servidor na porta ' + PORT);
  if (usuario) conectar(usuario);
});
