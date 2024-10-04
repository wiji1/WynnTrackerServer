const request = require('request');
const {join} = require("path");
const fs = require("fs");

function getWynnUser(uuid) {
    return new Promise((resolve, reject) => {
        const url = `https://api.wynncraft.com/v3/player/${uuid}`;

        request(url, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                resolve(JSON.parse(body));
            } else {
                reject('Request failed', error);
            }
        });
    });
}

function getGuildRank(uuid) {
    return new Promise((resolve, reject) => {
        getWynnUser(uuid).then((wynnUser) => {
            resolve(wynnUser.guild.rankStars.length);
        }).catch(reject);
    });
}

async function getPlayerGuild(uuid) {
    let player = await getWynnUser(uuid);
    if (!player.guild || player.guild === "NULL") return null;
    return player.guild.prefix;
}

async function isPlayerInGuild(uuid) {
    const configPath = join(__dirname, '../config.json');
    const data = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(data);

    let player = await getWynnUser(uuid);
    let guild = player.guild;
    return guild.prefix === config["guild-tag"];
}

module.exports = {getGuildRank, isPlayerInGuild, getPlayerGuild};