const crypto = require('crypto');

// Enhanced token storage with separate WebSocket and Mojang tokens
const tokenMap = new Map(); // uuid -> Token
const wsTokenLookup = new Map(); // wsToken -> uuid (for WebSocket authentication)
const mojangServerIds = new Map(); // serverId -> uuid (for Mojang authentication)

const TOKEN_EXPIRY_TIME = 6 * 60 * 60 * 1000; // 6 hours
const VALIDATION_CACHE_TIME = 30 * 60 * 1000; // 30 minutes

function addUser(uuid, wsToken, serverId = null) {
    const existingToken = tokenMap.get(uuid);
    if (existingToken) {
        removeToken(uuid);
    }
    
    const token = new Token(wsToken, serverId);
    tokenMap.set(uuid, token);
    wsTokenLookup.set(wsToken, uuid);
    
    if (serverId) {
        mojangServerIds.set(serverId, uuid);
    }
}

function getToken(uuid) {
    const token = tokenMap.get(uuid);
    if (!token) return null;
    
    if (token.isExpired()) {
        removeToken(uuid);
        return null;
    }
    
    return token;
}

function generateToken(uuid, serverId = null) {
    const wsToken = crypto.randomBytes(32).toString('hex');
    addUser(uuid, wsToken, serverId);
    return wsToken;
}

function generateTokenWithServerId(uuid) {
    const wsToken = crypto.randomBytes(32).toString('hex');
    const serverId = crypto.randomBytes(20).toString('hex');
    
    addUser(uuid, wsToken, serverId);
    return { wsToken, serverId };
}

function removeToken(uuid) {
    const token = tokenMap.get(uuid);
    if (token) {
        const stack = new Error().stack;
        const caller = stack.split('\n')[2].trim();
        const age = token.getAge();
        const isFromGuildUpdate = caller.includes('database.js') || caller.includes('updateGuild');
        
        if (isFromGuildUpdate && age < 300000) { // Less than 5 minutes old
            return false; // Don't remove the token
        }
        
        wsTokenLookup.delete(token.wsToken);
        
        if (token.serverId) {
            mojangServerIds.delete(token.serverId);
        }
        
        tokenMap.delete(uuid);
        return true;
    }
    return false;
}

function findUuidByToken(tokenString) {
    if (!tokenString) return null;
    
    const uuid = wsTokenLookup.get(tokenString);
    if (uuid) {
        const token = getToken(uuid);
        if (token && token.isAuthenticated()) {
            return uuid;
        }
    }
    
    return null;
}

function findUuidByServerId(serverId) {
    if (!serverId) return null;
    
    const uuid = mojangServerIds.get(serverId);
    if (uuid) {
        const token = getToken(uuid);
        if (token) {
            return uuid;
        }
    }
    
    return null;
}

function validateToken(tokenString) {
    if (!tokenString) {
        return { valid: false, reason: 'No token provided' };
    }

    let uuid = null;

    // First, try to find UUID by WebSocket token
    uuid = wsTokenLookup.get(tokenString);
    
    // If not found, try to find UUID by server ID
    if (!uuid) {
        uuid = mojangServerIds.get(tokenString);
    }

    if (!uuid) {
        return { valid: false, reason: 'Token not found' };
    }

    const token = tokenMap.get(uuid);
    if (!token) {
        wsTokenLookup.delete(tokenString);
        mojangServerIds.delete(tokenString);
        return { valid: false, reason: 'Token data not found' };
    }

    if (token.isExpired()) {
        console.log(`Token expired for UUID ${uuid}`);
        removeToken(uuid);
        return { valid: false, reason: 'Token expired' };
    }

    if (!token.isAuthenticated()) {
        return { valid: false, reason: 'Token not authenticated' };
    }

    token.updateLastValidated();

    return { 
        valid: true, 
        uuid: uuid,
        createdAt: token.createdAt,
        lastValidated: token.lastValidated,
        authenticated: token.authenticated
    };
}

function authenticateServerId(serverId) {
    const uuid = findUuidByServerId(serverId);
    if (uuid) {
        const token = getToken(uuid);
        if (token && token.serverId === serverId) {
            token.authenticate();
            return true;
        }
    }
    return false;
}

function isAuthenticated(uuid) {
    const token = getToken(uuid);
    return token && token.isAuthenticated();
}

function getAuthenticationStatus(uuid) {
    const token = getToken(uuid);
    if (!token) {
        return { authenticated: false, reason: 'No token found' };
    }

    if (token.isExpired()) {
        removeToken(uuid);
        return { authenticated: false, reason: 'Token expired' };
    }

    if (!token.isAuthenticated()) {
        return { authenticated: false, reason: 'Token not authenticated' };
    }

    return {
        authenticated: true,
        wsToken: token.wsToken,
        serverId: token.serverId,
        createdAt: token.createdAt,
        lastValidated: token.lastValidated
    };
}

function invalidateToken(tokenString) {
    const uuid = wsTokenLookup.get(tokenString);
    if (uuid) {
        removeToken(uuid);
        return true;
    }
    return false;
}

function invalidateUuidTokens(uuid) {
    const token = getToken(uuid);
    if (token) {
        removeToken(uuid);
        return true;
    }
    return false;
}

function getAllTokens() {
    return tokenMap;
}

function getAuthStats() {
    const now = Date.now();
    let activeTokens = 0;
    let expiringSoon = 0;
    let authenticatedTokens = 0;
    let tokensWithServerId = 0;

    tokenMap.forEach((token) => {
        const age = now - token.createdAt.getTime();
        if (age < TOKEN_EXPIRY_TIME) {
            activeTokens++;
            if (age > TOKEN_EXPIRY_TIME - (60 * 60 * 1000)) {
                expiringSoon++;
            }
            if (token.isAuthenticated()) {
                authenticatedTokens++;
            }
            if (token.serverId) {
                tokensWithServerId++;
            }
        }
    });

    return {
        totalTokens: tokenMap.size,
        activeTokens,
        authenticatedTokens,
        tokensWithServerId,
        expiringSoon,
        wsTokenLookups: wsTokenLookup.size,
        mojangServerIds: mojangServerIds.size
    };
}

function startTokenCleanup() {
    setInterval(() => {
        const expiredUuids = [];

        tokenMap.forEach((token, uuid) => {
            if (token.isExpired()) {
                expiredUuids.push(uuid);
            }
        });

        expiredUuids.forEach(uuid => {
            removeToken(uuid);
        });
    }, 60000); // Run every minute
}

function safeRemoveTokenForGuildUpdate(uuid, reason = 'guild_update') {
    const token = tokenMap.get(uuid);
    if (!token) return false;
    
    if (reason === 'player_kicked' || reason === 'player_left' || reason === 'player_removed') {
        return removeToken(uuid);
    } else {
        return false;
    }
}

class Token {
    constructor(wsToken, serverId = null) {
        this.wsToken = wsToken;
        this.serverId = serverId;
        this.authenticated = false;
        this.createdAt = new Date();
        this.lastValidated = new Date();
    }

    authenticate() {
        this.authenticated = true;
        this.lastValidated = new Date();
    }

    isAuthenticated() {
        return this.authenticated;
    }

    isExpired() {
        const now = Date.now();
        return (now - this.createdAt.getTime()) > TOKEN_EXPIRY_TIME;
    }

    updateLastValidated() {
        this.lastValidated = new Date();
        
        const age = this.getAge();
        if (age > 4 * 60 * 60 * 1000) { // 4 hours
            this.createdAt = new Date(Date.now() - (2 * 60 * 60 * 1000)); // Reset age to 2 hours
        }
    }

    getAge() {
        return Date.now() - this.createdAt.getTime();
    }

    getTimeSinceValidation() {
        return Date.now() - this.lastValidated.getTime();
    }

    get token() {
        return this.wsToken;
    }
}

startTokenCleanup();

module.exports = {
    generateToken, 
    generateTokenWithServerId,
    getToken, 
    removeToken, 
    safeRemoveTokenForGuildUpdate,
    findUuidByToken,
    findUuidByServerId,
    validateToken,
    authenticateServerId,
    isAuthenticated,
    getAuthenticationStatus,
    invalidateToken,
    invalidateUuidTokens,
    getAllTokens, 
    getAuthStats,
    Token
};