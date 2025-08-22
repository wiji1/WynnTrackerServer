const {getToken} = require("../auth/authentication");
const {toggleNeedsAspects} = require("../../core/database");
class ToggleAspectsEndpoint {

    async call(req, res) {
        let token = req.query.token;
        let {reporter} = req.query;

        let tokenObject = await getToken(reporter);

        if (!tokenObject || tokenObject.serverId !== token || !tokenObject.isAuthenticated()) return res.status(400).send("Invalid token");

        let result = await toggleNeedsAspects(reporter);
        if (result === null) return res.status(400).send("Reporter is not in the guild or has not completed a raid!");

        console.log("Toggling needed aspects: ", reporter, result);

        res.status(200).send(result);
    }
}

module.exports = { ToggleAspectsEndpoint }