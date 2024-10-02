const {getToken} = require("../authentication");
const {isPlayerInGuild} = require("../wynn-api");
const {insertRaid, getPlayerUUID, insertPlayer} = require("../database");
const {requestUUID} = require("../misc");

class ReportRaidEndpoint {
    constructor() {
        this.recentRaids = new Map();
    }

    async call(req, res) {
        let token = req.query.token;
        let {raid, player1, player2, player3, player4, reporter, seasonRating, guildXP} = req.query;

        if (!raid || !token || !player1 || !player2 || !player3 || !player4 || !reporter || !seasonRating || !guildXP) return res.status(400).send("Missing parameters");

        const reportKey = `${player1}-${player2}--${player3}--${player4}`;
        if (this.recentRaids.has(reportKey)) {
            await this.recentRaids.get(reportKey);
            return res.status(200).send("Raid reported");
        }

        const reportPromise = (async () => {
            let tokenObject = await getToken(reporter);

            if (!tokenObject || tokenObject.token !== token || !tokenObject.isAuthenticated()) return res.status(400).send("Invalid token");
            if (!await isPlayerInGuild(reporter)) return res.status(400).send("Reporter is not in the guild");

            let players = [player1, player2, player3, player4];

            for (let i = 0; i < players.length; i++) {
                let player = players[i];

                let uuid = await getPlayerUUID(player);

                if (!uuid) uuid = await requestUUID(player);
                if (!uuid) return res.status(400).send("Invalid player: " + player);

                players[i] = uuid;
            }

            console.log("Reporting raid: ", raid, player1, player2, player3, player4, reporter, seasonRating, guildXP);

            await insertRaid(raid, players[0], players[1], players[2], players[3], reporter, seasonRating, guildXP);
            res.status(200).send("Raid reported");

            setTimeout(() => {
                this.recentRaids.delete(reportKey);
            }, 1000 * 60);
        })();

        this.recentRaids.set(reportKey, reportPromise);
        await reportPromise;
    }
}

module.exports = { ReportRaidEndpoint }