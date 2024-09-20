const express = require('express');
const {databaseInit, insertRaid} = require("./database");
const {AuthenticateEndpoint} = require("./endpoints/authenticate-endpoint");
const {ReportRaidEndpoint} = require("./endpoints/report-raid-endpoint");
require("./discord/discord-bot");

const app = express();
const PORT = 80;

app.listen(PORT, '0.0.0.0', (error) => {
    if (!error) console.log("Server is Successfully Running, and App is listening on port " + PORT)
    else console.log("Error occurred, server can't start", error);

    databaseInit();
    registerEndpoints(app);
});

const endpoints = {
    'authenticate': new AuthenticateEndpoint(),
    'report-raid': new ReportRaidEndpoint()
};

function registerEndpoints(app) {
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



