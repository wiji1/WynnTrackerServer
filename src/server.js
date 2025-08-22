const express = require('express');
const http = require('http');
const {databaseInit} = require("./core/database");
const {AuthenticateEndpoint} = require("./features/auth/authenticate-endpoint");
const {ReportRaidEndpoint} = require("./features/raids/report-raid-endpoint");
const {IsAuthenticatedEndpoint} = require("./features/auth/is-authenticated-endpoint");
require("./discord/discord-bot");
const {ReportAspectEndpoint} = require("./features/aspects/report-aspect-endpoint");
const {initQueue} = require("./features/player/player-queue");
const {ToggleAspectsEndpoint} = require("./features/aspects/toggle-aspects-endpoint");
const {VerifyLinkEndpoint} = require("./features/account-linking/verify-link-endpoint");
const {UnlinkMinecraftEndpoint} = require("./features/account-linking/unlink-minecraft-endpoint");
const {PlayersEndpoint} = require("./features/player/players-endpoint");
const { badgesService } = require("./features/badges/badges-service");
const { config } = require("./core/config");
const {websocketInit} = require("./features/websocket/websocket");

const app = express();
const server = http.createServer(app);
const PORT = config.get("host-port") || 3000;

server.listen(PORT, '0.0.0.0', async (error) => {
    if (!error) console.log("Server is Successfully Running, and App is listening on port " + PORT)
    else console.log("Error occurred, server can't start", error);

    await databaseInit();
    registerEndpoints(app);
    await initQueue();
    websocketInit(server);
    
    badgesService.initialize().then(() => {
        console.log('Badge system ready');
    }).catch(error => {
        console.error('Badge system failed to initialize:', error);
    });
});

const endpoints = {
    'authenticate': new AuthenticateEndpoint(),
    'report-raid': new ReportRaidEndpoint(),
    'report-aspect': new ReportAspectEndpoint(),
    'is-authenticated': new IsAuthenticatedEndpoint(),
    'toggle-aspects': new ToggleAspectsEndpoint(),
    'verify-link': new VerifyLinkEndpoint(),
    'unlink-minecraft': new UnlinkMinecraftEndpoint(),
    'players': new PlayersEndpoint(),
};

function registerEndpoints(app) {
    app.get('/api/auth/websocket-token', async (req, res) => {
        if (!req.query.uuid) {
            return res.status(400).json({ error: "Missing UUID parameter" });
        }

        const { uuid } = req.query;
        
        try {
            const { getToken } = require("./features/auth/authentication");
            const token = getToken(uuid);
            
            if (!token) {
                return res.status(401).json({ error: "No token found" });
            }

            if (!token.isAuthenticated()) {
                return res.status(401).json({ error: "Not authenticated" });
            }

            if (token.isExpired()) {
                return res.status(401).json({ error: "Token expired" });
            }

            res.status(200).send(token.wsToken);
        } catch (error) {
            console.error(`Error getting WebSocket token for ${uuid}:`, error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post('/api/auth/refresh-token', async (req, res) => {
        if (!req.query.uuid) {
            return res.status(400).json({ error: "Missing UUID parameter" });
        }

        const { uuid } = req.query;
        
        try {
            const { getToken } = require("./features/auth/authentication");
            const token = getToken(uuid);
            
            if (!token) {
                return res.status(401).json({ error: "No token found" });
            }

            if (!token.isAuthenticated()) {
                return res.status(401).json({ error: "Not authenticated" });
            }

            token.updateLastValidated();
            
            res.status(200).json({
                success: true,
                refreshed_at: new Date().toISOString(),
                token_age: token.getAge()
            });
        } catch (error) {
            console.error(`Error refreshing token for ${uuid}:`, error);
            res.status(500).json({ error: "Internal server error" });
        }
    });
    
    app.use('/api/:endpoint', async (req, res) => {
        const endpointName = req.params.endpoint;
        const endpoint = endpoints[endpointName];

        if (endpoint && typeof endpoint.call === 'function') {
            await endpoint.call(req, res);
        } else {
            res.status(404).send('Endpoint not found');
        }
    });
}