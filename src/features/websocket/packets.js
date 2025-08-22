/**
 * WebSocket packet handlers for the WynnTracker server
 * Each function represents a specific packet type handler
 */

const PACKET_TYPES = {
    PING: 'ping',
    HEARTBEAT: 'heartbeat',
    CHAT_MESSAGE: 'chat_message',
    DISCORD_CHAT_MESSAGE: 'discord_chat_message',
    CHAT_MESSAGE_ACK: 'chat_message_ack',
    RANK_PROMOTION_REQUEST: 'rank_promotion_request',
    RANK_PROMOTION_RESPONSE: 'rank_promotion_response',
    CHAT_ANNOUNCEMENT: 'chat_announcement',
    CONNECT: 'connect',
    DISCONNECT: 'disconnect',
    PONG: 'pong',
    CONNECT_ACK: 'connect_ack',
    DISCONNECT_ACK: 'disconnect_ack'
};

const pingHandler = async (client, packet) => {
    return {
        type: PACKET_TYPES.PONG,
        data: {
            timestamp: Date.now(),
            clientId: client.id
        }
    };
};

const heartbeatHandler = async (client, packet) => {
    client.lastHeartbeat = Date.now();
    return null;
};

const chatMessageHandler = async (client, packet) => {
    const { chatBridge } = require('../chat-bridge/chat-bridge-service');
    return await chatBridge.handleMinecraftMessage(client, packet);
};

const connectHandler = async (client, packet) => {
    return {
        type: PACKET_TYPES.CONNECT_ACK,
        data: {
            message: 'Connection acknowledged',
            clientId: client.id,
            timestamp: Date.now()
        }
    };
};

const disconnectHandler = async (client, packet) => {
    client.shouldDisconnect = true;
    return {
        type: PACKET_TYPES.DISCONNECT_ACK,
        data: {
            message: 'Disconnect acknowledged'
        }
    };
};

const rankPromotionResponseHandler = async (client, packet) => {
    const { requestId, success, error, targetUsername, newRank } = packet.data;
    
    console.log(`Rank promotion response received from ${client.uuid}: ${success ? 'SUCCESS' : 'FAILED'} for ${targetUsername} -> rank ${newRank}`);
    
    const { rankService } = require('../ranks/rank-service');
    rankService.handlePromotionResponse(requestId, success, error);
    
    return {
        type: 'rank_promotion_ack',
        data: {
            requestId: requestId,
            acknowledged: true,
            timestamp: Date.now()
        }
    };
};

const chatAnnouncementHandler = async (client, packet) => {
    console.log(`Chat announcement received from Discord: Guild Alert: ${packet.data.guild_alert}, Message: ${packet.data.message}`);
    
    return {
        type: 'chat_announcement_ack',
        data: {
            acknowledged: true,
            timestamp: Date.now()
        }
    };
};

// Map of packet types to their handlers
const PACKET_HANDLERS = {
    [PACKET_TYPES.PING]: pingHandler,
    [PACKET_TYPES.HEARTBEAT]: heartbeatHandler,
    [PACKET_TYPES.CHAT_MESSAGE]: chatMessageHandler,
    [PACKET_TYPES.RANK_PROMOTION_RESPONSE]: rankPromotionResponseHandler,
    [PACKET_TYPES.CHAT_ANNOUNCEMENT]: chatAnnouncementHandler,
    [PACKET_TYPES.CONNECT]: connectHandler,
    [PACKET_TYPES.DISCONNECT]: disconnectHandler
};

module.exports = {
    PACKET_TYPES,
    PACKET_HANDLERS,
    pingHandler,
    heartbeatHandler,
    chatMessageHandler,
    rankPromotionResponseHandler,
    chatAnnouncementHandler,
    connectHandler,
    disconnectHandler
};