const WebSocket = require('ws');
const crypto = require('crypto');
const { PacketHandler } = require('./packet-handler');
const { findUuidByToken, validateToken } = require('../auth/authentication');

class WebSocketManager {
    constructor() {
        this.connections = new Map();
        this.uuidConnections = new Map();
        this.packetHandler = new PacketHandler();
        this.wss = null;
        this.heartbeatInterval = 30000; // 30 seconds
        this.heartbeatTimeout = 10000; // 10 seconds
    }

    init(server) {
        this.wss = new WebSocket.Server({ 
            server,
            path: '/ws',
            perMessageDeflate: false
        });

        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req);
        });

        console.log('WebSocket server initialized');
    }

    handleConnection(ws, req) {
        const clientId = crypto.randomUUID();
        
        const token = req.headers['authorization'] || req.headers['token'] || req.url.split('token=')[1]?.split('&')[0];
        let uuid = null;

        if (token) {
            // Validate token more thoroughly
            const tokenValidation = validateToken(token);
            if (tokenValidation.valid) {
                uuid = tokenValidation.uuid;
                console.log(`Authenticated connection for UUID: ${uuid}`);
            } else {
                console.warn(`Invalid token provided: ${token} - ${tokenValidation.reason}`);
                ws.close(1008, `Invalid authentication token: ${tokenValidation.reason}`);
                return;
            }
        } else {
            console.warn(`No token provided in connection headers`);
            ws.close(1008, 'Missing authentication token');
            return;
        }

        const clientInfo = {
            id: clientId,
            ws: ws,
            ip: req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
            connectedAt: new Date(),
            uuid: uuid,
            token: token,
            lastHeartbeat: Date.now(),
            heartbeatTimer: null
        };

        this.connections.set(clientId, clientInfo);
        
        if (uuid) this.addUuidConnection(uuid, clientId);
        
        console.log(`Client connected: ${clientId} UUID: ${uuid || 'unauthenticated'} from ${clientInfo.ip}`);

        // Start heartbeat monitoring for this client
        this.startClientHeartbeat(clientId);

        // Process any queued promotions for this client
        if (uuid) {
            const { rankService } = require('../ranks/rank-service');
            setTimeout(() => {
                rankService.processQueueForClient(uuid);
            }, 1000); // Small delay to ensure client is fully connected
        }

        this.sendMessage(ws, 'connection', {
            type: 'authenticated',
            clientId: clientId,
            uuid: uuid,
            timestamp: new Date().toISOString()
        });

        ws.on('message', (data) => {
            this.handleMessage(clientId, data);
        });

        ws.on('close', (code, reason) => {
            this.handleDisconnect(clientId, code, reason);
        });

        ws.on('error', (error) => {
            this.handleError(clientId, error);
        });

        ws.on('pong', () => {
            const client = this.connections.get(clientId);
            if (client) {
                client.lastPong = Date.now();
                client.lastHeartbeat = Date.now();
            }
        });
    }

    startClientHeartbeat(clientId) {
        const client = this.connections.get(clientId);
        if (!client) return;

        // Clear any existing timer
        if (client.heartbeatTimer) {
            clearInterval(client.heartbeatTimer);
        }

        // Set up heartbeat monitoring
        client.heartbeatTimer = setInterval(() => {
            const currentClient = this.connections.get(clientId);
            if (!currentClient) {
                clearInterval(client.heartbeatTimer);
                return;
            }

            const now = Date.now();
            const timeSinceLastHeartbeat = now - currentClient.lastHeartbeat;

            // Check if client has been unresponsive
            if (timeSinceLastHeartbeat > this.heartbeatTimeout + this.heartbeatInterval) {
                console.log(`Client ${clientId} (${currentClient.uuid}) heartbeat timeout, disconnecting`);
                this.disconnectClient(clientId, 'Heartbeat timeout');
                return;
            }

            // Send ping
            if (currentClient.ws.readyState === WebSocket.OPEN) {
                currentClient.ws.ping();
            }
        }, this.heartbeatInterval);
    }

    async handleMessage(clientId, data) {
        try {
            const packet = JSON.parse(data);
            const client = this.connections.get(clientId);
            
            if (!client) {
                console.warn(`Packet from unknown client: ${clientId}`);
                return;
            }

            // Update heartbeat timestamp for any message
            client.lastHeartbeat = Date.now();

            // Handle heartbeat packets
            if (packet.type === 'heartbeat') {
                this.sendMessage(client.ws, 'heartbeat_response', {
                    timestamp: Date.now(),
                    clientTimestamp: packet.timestamp
                });
                return;
            }

            // Don't validate tokens on every message - trust the authenticated connection
            // Token validation was causing disconnections during normal operation

            console.log(`Packet from ${clientId} (${client.uuid || 'unauthenticated'}):`, packet);
            const response = await this.packetHandler.handlePacket(client, packet);
            
            if (response) this.sendMessage(client.ws, response.type, response.data);
        } catch (error) {
            console.error(`Error handling packet from ${clientId}:`, error);
            const client = this.connections.get(clientId);
            if (client) {
                this.sendError(client.ws, error.message || 'Packet handling error');
            }
        }
    }

    validateClientToken(client) {
        if (!client.token || !client.uuid) return false;

        try {
            const validation = validateToken(client.token);
            return validation.valid && validation.uuid === client.uuid;
        } catch (error) {
            console.error(`Error validating token for client ${client.id}:`, error);
            return false;
        }
    }

    handleDisconnect(clientId, code, reason) {
        const client = this.connections.get(clientId);
        if (client) {
            console.log(`Client disconnected: ${clientId} UUID: ${client.uuid || 'unauthenticated'} (${code}: ${reason})`);
            
            // Clear heartbeat timer
            if (client.heartbeatTimer) {
                clearInterval(client.heartbeatTimer);
            }
            
            if (client.uuid) this.removeUuidConnection(client.uuid, clientId);
            
            this.connections.delete(clientId);
        }
    }

    handleError(clientId, error) {
        console.error(`WebSocket error for client ${clientId}:`, error);
        const client = this.connections.get(clientId);
        if (client) {
            if (client.heartbeatTimer) {
                clearInterval(client.heartbeatTimer);
            }
            
            if (client.uuid) this.removeUuidConnection(client.uuid, clientId);
            
            client.ws.terminate();
            this.connections.delete(clientId);
        }
    }

    disconnectClient(clientId, reason = 'Server disconnect') {
        const client = this.connections.get(clientId);
        if (client) {
            if (client.heartbeatTimer) {
                clearInterval(client.heartbeatTimer);
            }
            
            client.ws.close(1000, reason);
            if (client.uuid) this.removeUuidConnection(client.uuid, clientId);
            this.connections.delete(clientId);
        }
    }

    addUuidConnection(uuid, clientId) {
        if (this.uuidConnections.has(uuid)) {
            const existingClientId = this.uuidConnections.get(uuid);
            const existingClient = this.connections.get(existingClientId);
            if (existingClient) {
                console.log(`Closing existing connection ${existingClientId} for UUID ${uuid} due to new connection`);
                existingClient.ws.close(1000, 'New connection established');
                if (existingClient.heartbeatTimer) {
                    clearInterval(existingClient.heartbeatTimer);
                }
                this.connections.delete(existingClientId);
            }
        }
        this.uuidConnections.set(uuid, clientId);
        console.log(`UUID ${uuid} now has 1 connection (replaced any existing connections)`);
    }

    removeUuidConnection(uuid, clientId) {
        if (this.uuidConnections.has(uuid) && this.uuidConnections.get(uuid) === clientId) {
            this.uuidConnections.delete(uuid);
        }
    }

    sendMessage(ws, type, data) {
        if (ws.readyState === WebSocket.OPEN) {
            const message = {
                type: type,
                data: data,
                timestamp: new Date().toISOString()
            };
            ws.send(JSON.stringify(message));
        }
    }

    sendError(ws, error) {
        this.sendMessage(ws, 'error', { message: error });
    }

    broadcast(type, data, filter = null) {
        const message = JSON.stringify({
            type: type,
            data: data,
            timestamp: new Date().toISOString()
        });

        this.connections.forEach((client) => {
            if (client.ws.readyState === WebSocket.OPEN) {
                if (!filter || filter(client)) {
                    client.ws.send(message);
                }
            }
        });
    }

    sendToUuid(uuid, type, data) {
        const clientId = this.uuidConnections.get(uuid);
        if (clientId) {
            const client = this.connections.get(clientId);
            if (client && client.ws.readyState === WebSocket.OPEN) {
                // Don't validate token for active WebSocket connections - trust the connection
                this.sendMessage(client.ws, type, data);
                return true;
            }
        }
        return false;
    }

    disconnectUuid(uuid, reason = 'Disconnected by server') {
       const clientId = this.uuidConnections.get(uuid);
       if (clientId) {
           const client = this.connections.get(clientId);
           if (client) {
               if (client.heartbeatTimer) {
                   clearInterval(client.heartbeatTimer);
               }
               client.ws.close(1000, reason);
               this.connections.delete(clientId);
           }
           this.uuidConnections.delete(uuid);
           console.log(`Disconnected client for UUID: ${uuid} - ${reason}`);
       }
    }

    // Periodic cleanup of stale connections
    startPeriodicCleanup() {
        setInterval(() => {
            const now = Date.now();
            const staleConnections = [];

            this.connections.forEach((client, clientId) => {
                // Check for stale connections (no heartbeat for longer than expected)
                const timeSinceHeartbeat = now - client.lastHeartbeat;
                
                // Only consider truly stale connections (much longer timeout)
                if (timeSinceHeartbeat > this.heartbeatTimeout + this.heartbeatInterval + 120000) { // 2+ minutes extra
                    console.log(`Marking connection ${clientId} as stale: ${timeSinceHeartbeat}ms since last heartbeat`);
                    staleConnections.push(clientId);
                }
                // Don't validate tokens for connected clients - this was causing the issue
                // Removed token validation from periodic cleanup
            });

            staleConnections.forEach(clientId => {
                console.log(`Cleaning up truly stale connection: ${clientId}`);
                this.disconnectClient(clientId, 'Stale connection cleanup');
            });

            if (staleConnections.length > 0) {
                console.log(`Cleaned up ${staleConnections.length} truly stale connections`);
            }
        }, 300000); // Run every 5 minutes instead of every minute
    }

    startHeartbeat() {
        // Legacy method - now using per-client heartbeat monitoring
        this.startPeriodicCleanup();
    }

    getConnectedClients() {
        return Array.from(this.connections.values()).map(client => ({
            id: client.id,
            ip: client.ip,
            connectedAt: client.connectedAt,
            authenticated: !!client.uuid,
            uuid: client.uuid,
            playerStatus: client.playerStatus,
            location: client.location,
            lastHeartbeat: new Date(client.lastHeartbeat)
        }));
    }

    getClientCount() {
        return this.connections.size;
    }

    getConnectedUuids() {
        return Array.from(this.uuidConnections.keys());
    }

    registerPacketHandler(type, handler) {
        this.packetHandler.registerPacket(type, handler);
    }
}

const wsManager = new WebSocketManager();

function websocketInit(server) {
    wsManager.init(server);
    wsManager.startHeartbeat();
    return wsManager;
}

module.exports = { websocketInit, wsManager };