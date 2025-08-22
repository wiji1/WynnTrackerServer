const {getToken} = require("../auth/authentication");
const {getPlayerUUID, insertAspect} = require("../../core/database");
const {requestUUID} = require("../../core/utilities");

class ReportAspectEndpoint {
    constructor() {
        this.recentReports = new Map();
    }

    async call(req, res) {
        let token = req.query.token;
        let {giver, receiver, reporter} = req.query;

        if (!token || !giver || !receiver) return res.status(400).send("Missing parameters");

        const reportKey = `${giver}-${receiver}`;
        if (this.recentReports.has(reportKey)) {
            await this.recentReports.get(reportKey);
            return res.status(200).send("Aspect reported");
        }

        const reportPromise = (async () => {
            let tokenObject = await getToken(reporter);

            if (!tokenObject || tokenObject.serverId !== token || !tokenObject.isAuthenticated()) return res.status(400).send("Invalid token");

            let giverUUID = await getPlayerUUID(giver);
            let receiverUUID = await getPlayerUUID(receiver);

            if (!giverUUID) giverUUID = await requestUUID(giver).uuid;
            if (!receiverUUID) receiverUUID = await requestUUID(receiver).uuid;

            if (!giverUUID || !receiverUUID) return res.status(400).send("Invalid player");

            console.log("Reporting aspect: ", giver, receiver, reporter);

            await insertAspect(giverUUID, receiverUUID, reporter);
            res.status(200).send("Aspect reported");

            setTimeout(() => {
                this.recentReports.delete(reportKey);
            }, 500);
        })();

        this.recentReports.set(reportKey, reportPromise);
        await reportPromise;
    }
}

module.exports = { ReportAspectEndpoint }