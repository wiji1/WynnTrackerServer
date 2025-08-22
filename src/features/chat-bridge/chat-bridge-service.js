const { DiscordWebhook } = require('../../core/discord-webhook');
const { wsManager } = require('../websocket/websocket');
const { config } = require('../../core/config');
const accountLinkingService = require('../account-linking/account-linking-service');
const { rankService } = require('../ranks/rank-service');
const {requestUUID} = require("../../core/utilities");
const {analyzeAndFormatItems} = require("./encoded-item");


class ChatBridgeService {
    constructor() {
        this.discordWebhook = new DiscordWebhook();
        this.messageCache = new Map();
        this.cacheExpiry = 5000; // 5 seconds
        this.cleanupInterval = 30000; // 30 seconds

        this.config = config.get('chat-bridge');
        
        this.startCleanup();
    }

    setDiscordClient(client) {
        this.discordWebhook.setDiscordClient(client);
    }

    generateMessageHash(username, message, timestamp = null) {
        const time = timestamp || Date.now();
        return `${username}:${message}:${Math.floor(time / 1000)}`;
    }

    isDuplicateMessage(username, message, timestamp = null) {
        const hash = this.generateMessageHash(username, message, timestamp);
        
        if (this.messageCache.has(hash)) {
            return true;
        }
        
        this.messageCache.set(hash, Date.now());
        return false;
    }

    async handleMinecraftMessage(client, packet) {
        const { username, message } = packet.data;
        const uuidAndName = await requestUUID(username);
        const uuid = uuidAndName.uuid;

        if (!uuid) {
            console.warn(`Could not resolve UUID for username: ${username}`);
            return null;
        }

        if (!username || !message) {
            console.warn('Invalid chat message packet: missing username or message');
            return null;
        }

        if (this.isDuplicateMessage(username, message)) {
            console.log(`Duplicate message filtered: ${username}: ${message}`);
            return null;
        }

        console.log(`Processing Minecraft message: ${username}: ${message}: ${uuid}`);
        
        let messageData = message;
        let success = false;

        if (message.includes('󰀀󰄀')) {
            console.log(`Item hash detected in message from ${username}`);
            
            try {
                messageData = await analyzeAndFormatItems(message);
                console.log(`Successfully processed item analysis for ${username}`);
            } catch (error) {
                console.error(`Error processing item hash from ${username}:`, error.message);
                console.log(`Falling back to original message for ${username}`);
            }
        }

        success = await this.discordWebhook.sendMinecraftSkinMessage(username, messageData, uuid);
        
        if (success) {
            console.log(`Bridged message to Discord from ${username}`);
        } else {
            console.error(`Failed to bridge message to Discord from ${username}`);
        }

        return {
            type: 'chat_message_ack',
            data: {
                success: success,
                timestamp: Date.now()
            }
        };
    }

    async handleDiscordMessage(author, content, channelId) {
        if (!this.config.enabled) return;
        
        if (channelId !== this.config['channel-id']) return;

        if (author.bot) return;

        // Check if the Discord user has a linked Minecraft account
        const accountLink = await accountLinkingService.getLink(author.id);
        if (!accountLink) {
            console.log(`Discord user ${author.username} (${author.id}) is not linked to a Minecraft account - message not bridged`);
            return;
        }

        // Use the linked Minecraft username instead of Discord username
        const minecraftUsername = accountLink.minecraft_username;
        const minecraftUuid = accountLink.minecraft_uuid;
        const message = content;

        if (this.isDuplicateMessage(minecraftUsername, message)) {
            console.log(`Duplicate Discord message filtered: ${minecraftUsername}: ${message}`);
            return;
        }

        // Get the user's rank information
        const userRank = await rankService.getMemberRank(author.id);
        if (!userRank) {
            console.warn(`No rank found for Discord user ${author.username} (${author.id}) - message not bridged`);
            return;
        }

        let rank = userRank.identifier;

        console.log(`Processing Discord message from ${author.username} (linked as ${minecraftUsername}${userRank ? ` - ${userRank.identifier}` : ''}): ${message}`);

        const messageData = {
            type: 'discord_chat_message',
            data: {
                username: minecraftUsername,
                message: message,
                timestamp: Date.now(),
                uuid: minecraftUuid,
                avatarUrl: `https://crafatar.com/avatars/${minecraftUuid}?size=64&default=MHF_Steve&overlay`,
                rank: rank
            }
        };

        wsManager.broadcast(messageData.type, messageData.data);
        console.log(`Bridged message to Minecraft clients from ${minecraftUsername} (Discord: ${author.username}${userRank ? ` - ${userRank.identifier}` : ''})`);
        
    }

    startCleanup() {
        setInterval(() => {
            const now = Date.now();
            const expiredEntries = [];
            
            for (const [hash, timestamp] of this.messageCache.entries()) {
                if (now - timestamp > this.cacheExpiry) {
                    expiredEntries.push(hash);
                }
            }
            
            expiredEntries.forEach(hash => this.messageCache.delete(hash));
            
            if (expiredEntries.length > 0) {
                console.log(`Cleaned up ${expiredEntries.length} expired message cache entries`);
            }
        }, this.cleanupInterval);
    }

    getStats() {
        return {
            cacheSize: this.messageCache.size,
            cacheExpiry: this.cacheExpiry,
            cleanupInterval: this.cleanupInterval
        };
    }
}

const chatBridge = new ChatBridgeService();

module.exports = { ChatBridgeService, chatBridge };