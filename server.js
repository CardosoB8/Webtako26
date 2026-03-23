const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const path = require('path');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Domínio original onde estão as APIs
const TARGET = 'https://app.sscashout.online';

// ===================== MIDDLEWARES =====================
app.use(cors({
  origin: true,
  credentials: true
}));

// Logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ===================== PROXY PARA API REST =====================
app.use('/api', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  secure: true,
  // Preserva cookies
  onProxyReq: (proxyReq, req, res) => {
    if (req.headers.cookie) {
      proxyReq.setHeader('cookie', req.headers.cookie);
    }
    // Remove headers problemáticos
    proxyReq.removeHeader('origin');
    proxyReq.removeHeader('referer');
  },
  onProxyRes: (proxyRes, req, res) => {
    // Adiciona headers CORS na resposta
    proxyRes.headers['access-control-allow-origin'] = req.headers.origin || '*';
    proxyRes.headers['access-control-allow-credentials'] = 'true';
  },
  // Timeout maior para SSE
  proxyTimeout: 600000,
  timeout: 600000
}));

// ===================== PROXY ESPECIAL PARA SSE (STREAM) =====================
// O SSE precisa de tratamento especial para manter a conexão aberta
app.use('/api/stream', (req, res) => {
  console.log(`[SSE] Conexão estabelecida: ${req.url}`);
  
  // Opções para a requisição ao servidor original
  const options = {
    hostname: 'app.sscashout.online',
    path: req.url,
    method: 'GET',
    headers: {
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...(req.headers.cookie && { 'Cookie': req.headers.cookie }),
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
    }
  };

  // Faz a requisição para o servidor original
  const protocol = TARGET.startsWith('https') ? https : http;
  
  const proxyReq = protocol.request(options, (proxyRes) => {
    // Configura headers da resposta para o cliente
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'X-Accel-Buffering': 'no' // Desativa buffering no Nginx
    });

    // Encaminha os dados do stream em tempo real
    proxyRes.on('data', (chunk) => {
      res.write(chunk);
    });

    proxyRes.on('end', () => {
      console.log('[SSE] Conexão encerrada pelo servidor');
      res.end();
    });

    proxyRes.on('error', (err) => {
      console.error('[SSE] Erro no stream:', err);
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error('[SSE] Erro na requisição proxy:', err);
    res.status(500).json({ error: 'Stream error' });
  });

  // Timeout da requisição (5 minutos)
  proxyReq.setTimeout(300000, () => {
    console.log('[SSE] Timeout');
    proxyReq.destroy();
    res.end();
  });

  proxyReq.end();

  // Quando o cliente desconectar
  req.on('close', () => {
    console.log('[SSE] Cliente desconectado');
    proxyReq.destroy();
  });
});

// ===================== PROXY PARA ARQUIVO VAPID =====================
app.use('/vapidPublicKey.txt', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  secure: true,
  onProxyRes: (proxyRes, req, res) => {
    proxyRes.headers['access-control-allow-origin'] = req.headers.origin || '*';
  }
}));

// ===================== PROXY PARA OUTROS ENDPOINTS =====================
app.use('/api/online', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  secure: true
}));

app.use('/api/stats', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  secure: true
}));

app.use('/api/velas', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  secure: true
}));

app.use('/api/ultimo-historico', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  secure: true
}));

app.use('/api/subscribe', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  secure: true
}));

app.use('/api/affiliate', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  secure: true
}));

// ===================== SERVE ARQUIVOS ESTÁTICOS =====================
// Coloque todos os seus arquivos (index.html, app.js, etc.) na pasta "public"
app.use(express.static(path.join(__dirname, 'public')));

// Rota padrão para qualquer outra requisição - serve o index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===================== INICIA O SERVIDOR =====================
app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`🚀 Proxy server rodando em: http://localhost:${PORT}`);
  console.log(`📡 Encaminhando requisições para: ${TARGET}`);
  console.log(`📁 Servindo arquivos estáticos da pasta: public/`);
  console.log(`========================================\n`);
});