const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');

// El enum MessageType se traduce a un objeto simple en JavaScript.
const MessageType = {
    IDENTIFY: 'IDENTIFY',
    SYNC_REQUEST: 'SYNC_REQUEST',
    STATE_UPDATE: 'STATE_UPDATE',
    SERVICE_UPDATE: 'SERVICE_UPDATE',
    SYNC_RESPONSE: 'SYNC_RESPONSE',
    STATE_CHANGED_BY_MONITOR: 'STATE_CHANGED_BY_MONITOR',
    REQUEST_STATE: 'REQUEST_STATE',
    STATE_RESPONSE: 'STATE_RESPONSE',
};


const clients = new Map();
let masterPanelId = null;
let currentServiceState = {
    liveState: null,
    timeline: [],
    service: null, // Agregado para una sincronización completa
};

const wss = new WebSocketServer({ port: 8080 });
console.log('Intelligent WebSocket server (JS version) started on port 8080');

function broadcast(message, senderId, targetType) {
  const messageString = JSON.stringify(message);
  console.log(`Broadcasting (from ${senderId}, to ${targetType || 'all'}):`, messageString.substring(0, 250) + '...');
  
  clients.forEach(client => {
    if (client.ws.readyState === WebSocket.OPEN) {
       if (!targetType || targetType === 'all' || client.type === targetType) {
          client.ws.send(messageString);
       }
    }
  });
}

wss.on('connection', ws => {
  const clientId = uuidv4();
  console.log(`Client connected with temporary ID: ${clientId}`);

  ws.on('message', (messageBuffer) => {
    const messageString = messageBuffer.toString();
    let data;
    try {
        data = JSON.parse(messageString);
    } catch(e) {
        console.error("Failed to parse message:", messageString);
        return;
    }
    
    console.log(`Message from ${clientId} (type: ${data.type}):`);

    switch(data.type) {
        case MessageType.IDENTIFY:
            const clientType = data.payload.type;
            clients.set(clientId, { id: clientId, type: clientType, ws });
            console.log(`Client ${clientId} identified as ${clientType}`);

            if (clientType === 'panel') {
                if (!masterPanelId) {
                    masterPanelId = clientId;
                    console.log(`Client ${clientId} is now the master panel.`);
                    // El nuevo maestro enviará su estado con SYNC_REQUEST
                } else {
                    console.log(`Client ${clientId} is a secondary panel. Sending current state.`);
                    ws.send(JSON.stringify({
                        type: MessageType.SYNC_RESPONSE,
                        payload: currentServiceState
                    }));
                }
            } else if (clientType === 'monitor') {
                // Enviar estado actual al nuevo monitor
                 if (currentServiceState.liveState) {
                    ws.send(JSON.stringify({
                        type: MessageType.STATE_UPDATE,
                        payload: currentServiceState.liveState
                    }));
                }
            }
            break;

        case MessageType.SYNC_REQUEST:
            if (clientId === masterPanelId) {
                console.log(`Master panel ${clientId} sent its state. Storing and broadcasting to other panels.`);
                currentServiceState = data.payload;
                clients.forEach(client => {
                    if (client.type === 'panel' && client.id !== clientId && client.ws.readyState === WebSocket.OPEN) {
                        client.ws.send(JSON.stringify({
                            type: MessageType.SYNC_RESPONSE,
                            payload: currentServiceState
                        }));
                    }
                });
            }
            break;
        
        case MessageType.SERVICE_UPDATE:
             if (clients.get(clientId)?.type === 'panel') {
                console.log(`Panel ${clientId} sent a service update.`);
                currentServiceState.timeline = data.payload.timeline;
                broadcast(data, clientId, 'panel'); // Notificar a todos los paneles
             }
            break;

        case MessageType.STATE_UPDATE:
             if (clients.get(clientId)?.type === 'panel') {
                console.log(`Panel ${clientId} sent a state update for monitors.`);
                currentServiceState.liveState = data.payload;
                broadcast(data, clientId, 'monitor');
             }
            break;
            
        case MessageType.STATE_CHANGED_BY_MONITOR:
             if (clients.get(clientId)?.type === 'monitor') {
                console.log(`Monitor ${clientId} confirmed state change. Notifying all panels.`);
                currentServiceState.liveState = data.payload;
                broadcast(data, clientId, 'panel');
             }
            break;
        
        case MessageType.REQUEST_STATE:
             if (clients.get(clientId)?.type === 'monitor' && currentServiceState.liveState) {
                 console.log(`Monitor ${clientId} requested state. Sending live state.`);
                 ws.send(JSON.stringify({
                     type: MessageType.STATE_RESPONSE,
                     payload: currentServiceState.liveState
                 }));
             }
             break;

        default:
            console.warn(`Unhandled message type: ${data.type}. Broadcasting to all.`);
            broadcast(data, clientId, 'all');
            break;
    }
  });

  ws.on('close', () => {
    const client = clients.get(clientId);
    if (client) {
        console.log(`Client ${client.id} (${client.type}) disconnected`);
        clients.delete(clientId);
    }
    
    if (clientId === masterPanelId) {
        masterPanelId = null;
        const nextPanel = Array.from(clients.values()).find(c => c.type === 'panel');
        if (nextPanel) {
            masterPanelId = nextPanel.id;
            console.log(`New master panel promoted: ${masterPanelId}`);
        } else {
            console.log("No panels left. Clearing service state.");
            currentServiceState = { liveState: null, timeline: [], service: null };
        }
    }
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error from ${clientId}:`, error);
  });
});
