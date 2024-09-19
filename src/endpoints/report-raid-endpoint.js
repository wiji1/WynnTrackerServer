const {getToken} = require("../authentication");
const {isPlayerInGuild} = require("../wynn-api");
const {insertRaid, getPlayerUUID, insertPlayer} = require("../database");
const request = require('request');
const uuid = require("uuid");

class ReportRaidEndpoint {
    constructor() {
        this.recentRaids = [];
    }

    async call(req, res) {
        let token = req.query.token;
        let {raid, player1, player2, player3, player4, reporter} = req.query;

        if (!raid || !token || !player1 || !player2 || !player3 || !player4 || !reporter) return res.status(400).send("Missing parameters");

        let tokenObject = await getToken(reporter);

        if (!tokenObject || tokenObject.token !== token || !tokenObject.isAuthenticated()) return res.status(400).send("Invalid token");
        if (!await isPlayerInGuild(reporter)) return res.status(400).send("Reporter is not in the guild");

        let players = [player1, player2, player3, player4];

        for (let i = 0; i < players.length; i++) {
            let player = players[i];

            let uuid = await getPlayerUUID(player);

            if (!uuid) uuid = await this.requestUUID(player);
            if (!uuid) return res.status(400).send("Invalid player: " + player);
            if (this.checkForRecentRaid(uuid)) return res.status(200).send("Raid Reported");

            players[i] = uuid;
        }

        console.log("Reporting raid: ", raid, player1, player2, player3, player4, reporter);

        await insertRaid(raid, players[0], players[1], players[2], players[3], reporter);
        this.addRecentRaid(players);
        res.status(200).send("Raid reported");
    }

    checkForRecentRaid(player) {
        return this.recentRaids.includes(player);
    }

    addRecentRaid(players) {
        players.forEach(player => {
            this.recentRaids.push(player);
            setTimeout(() => {
                this.recentRaids = this.recentRaids.filter(p => p !== player);
            }, 60000);
        });
    }

    requestUUID(username) {
        return new Promise((resolve, reject) => {
            const url = `https://api.mojang.com/users/profiles/minecraft/${username}`;

            request(url, function (error, response, body) {
                if (!error && response.statusCode === 200) {
                    let data = JSON.parse(body);
                    if (data && data.id) {
                        let id = data.id.replace(
                            /(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/,
                            '$1-$2-$3-$4-$5'
                        );
                        resolve(id);

                        insertPlayer(id, username).catch(err => console.error('Error inserting player:', err));
                    } else {
                        resolve(null);
                    }
                } else {
                    console.error('Request failed', error);
                    reject(error);
                }
            });
        }).catch(err => {
            console.error('Error in requestUUID:', err);
            return null;
        });
    }
}

module.exports = { ReportRaidEndpoint }