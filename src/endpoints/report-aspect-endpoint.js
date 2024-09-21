const {getToken} = require("../authentication");
const {isPlayerInGuild} = require("../wynn-api");
const {getPlayerUUID, insertAspect} = require("../database");
const {requestUUID} = require("../misc");

class ReportAspectEndpoint {
    constructor() {
        this.recentReport = false;
    }

    async call(req, res) {
        let token = req.query.token;
        let {giver, receiver, reporter} = req.query;

        if (!token || !giver || !receiver) return res.status(400).send("Missing parameters");

        console.log("Aspect report attempt: " + reporter);
        if (this.recentReport) return res.status(200).send("Aspect reported");
        console.log("Aspect report not recent");

        let tokenObject = await getToken(reporter);

        if (!tokenObject || tokenObject.token !== token || !tokenObject.isAuthenticated()) return res.status(400).send("Invalid token");
        if (!await isPlayerInGuild(reporter)) return res.status(400).send("Reporter is not in the guild");

        let giverUUID = await getPlayerUUID(giver);
        let receiverUUID = await getPlayerUUID(receiver);

        if (!giverUUID) giverUUID = await requestUUID(giver);
        if (!receiverUUID) receiverUUID = await requestUUID(receiver);

        if (!giverUUID || !receiverUUID) return res.status(400).send("Invalid player");

        console.log("Reporting aspect: ", giver, receiver, reporter);

        await insertAspect(giverUUID, receiverUUID, reporter);
        res.status(200).send("Aspect reported");

        this.recentReport = true;
        console.log("Aspect report cooldown started");

        setTimeout(() => {
            console.log("Aspect report cooldown ended");
            this.recentReport = false;
        }, 500);
    }
}

module.exports = { ReportAspectEndpoint }