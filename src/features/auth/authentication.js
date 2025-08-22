const crypto = require('crypto');

const tokenMap = new Map();
const wsTokenLookup = new Map();
const mojangServerIds = new Map();

const TOKEN_EXPIRY_TIME = 6 * 60 * 60 * 1000;
const VALIDATION_CACHE_TIME = 30 * 60 * 1000;

function addUser(uuid, wsToken, serverId = null) {
    removeToken(uuid);
    
    const token = new Token(wsToken, serverId);
    tokenMap.set(uuid, token);
    wsTokenLookup.set(wsToken, uuid);
    
    if (serverId) {
        mojangServerIds.set(serverId, uuid);
    }
    
    console.log(`Added tokens for UUID: ${uuid} - WS: ${wsToken.substring(0, 8)} ServerId: ${serverId ? serverId.substring(0, 8) + '' : 'none'}`);
}

function getToken(uuid) {
    const token = tokenMap.get(uuid);
    if (!token) return null;
    
    if (token.isExpired()) {
        console.log(`Token expired for UUID: ${uuid}`);
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
        wsTokenLookup.delete(token.wsToken);
                if (token.serverId) {
            mojangServerIds.delete(token.serverId);
        }
        
        tokenMap.delete(uuid);
        console.log(`Removed all tokens for UUID: ${uuid}`);
    }
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

    const uuid = wsTokenLookup.get(tokenString);
    if (!uuid) {
        return { valid: false, reason: 'Token not found' };
    }

    const token = tokenMap.get(uuid);
    if (!token) {
        wsTokenLookup.delete(tokenString);
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
            console.log(`Authenticated server id ${serverId.substring(0, 8)}... for UUID ${uuid}`);
            return true;
        }
    }
    console.error(`Could not authenticate server id: ${serverId}`);
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

        if (expiredUuids.length > 0) {
            console.log(`Cleaned up ${expiredUuids.length} expired tokens`);
        }
    }, 60000);
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
        console.log(`Token authenticated for socket: ${this.wsToken.substring(0, 8)}`);
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
        if (age > 4 * 60 * 60 * 1000) {
            console.log(`Extending token life for token: ${this.wsToken.substring(0, 8)}`);
            this.createdAt = new Date(Date.now() - (2 * 60 * 60 * 1000));
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
    findUuidByToken,
    findUuidByServerId,
    validateToken,
    authenticateServerId,
    isAuthenticated,
    getAuthenticationStatus,
    invalidateToken,
    invalidateUuidTokens,
    Token
};