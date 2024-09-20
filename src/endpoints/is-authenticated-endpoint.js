const {getToken} = require("../authentication");

class IsAuthenticatedEndpoint {

    async call(req, res) {
        if (!req.query.uuid) return res.status(400).send("Missing parameters");
        let {uuid} = req.query;

        let token = getToken(uuid);

        if (!token || !token.isAuthenticated()) return res.status(401).send("Not authenticated");
        else return res.status(200).send("Authenticated");
    }
}

module.exports = { IsAuthenticatedEndpoint }