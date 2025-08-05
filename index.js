const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Servir archivos estáticos
app.use(express.static('public'));

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Almacenar conexiones activas
const clients = new Set();

// Manejar conexiones WebSocket
wss.on('connection', (ws) => {
  console.log('Nueva conexión WebSocket establecida');
  
  // Agregar cliente a la lista
  clients.add(ws);
  
  // Enviar mensaje de bienvenida
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Conectado al servidor WebSocket',
    timestamp: new Date().toISOString()
  }));
  
  // Notificar a otros clientes sobre la nueva conexión
  broadcast({
    type: 'user_joined',
    message: 'Un usuario se ha conectado',
    timestamp: new Date().toISOString(),
    clientCount: clients.size
  }, ws);
  
  // Manejar mensajes recibidos
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('Mensaje recibido:', message);
      
      // Dispersar el mensaje a todas las conexiones
      broadcast({
        type: 'message',
        content: message.content || message,
        timestamp: new Date().toISOString(),
        sender: message.sender || 'Anónimo'
      });
      
    } catch (error) {
      console.error('Error al procesar mensaje:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Error al procesar el mensaje'
      }));
    }
  });
  
  // Manejar desconexión
  ws.on('close', () => {
    console.log('Conexión WebSocket cerrada');
    clients.delete(ws);
    
    // Notificar a otros clientes sobre la desconexión
    broadcast({
      type: 'user_left',
      message: 'Un usuario se ha desconectado',
      timestamp: new Date().toISOString(),
      clientCount: clients.size
    });
  });
  
  // Manejar errores
  ws.on('error', (error) => {
    console.error('Error en WebSocket:', error);
    clients.delete(ws);
  });
});

// Función para dispersar mensajes a todas las conexiones
function broadcast(message, excludeClient = null) {
  const messageString = JSON.stringify(message);
  
  clients.forEach((client) => {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      client.send(messageString);
    }
  });
}

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`WebSocket disponible en ws://localhost:${PORT}`);
});