const mysql = require('mysql2/promise');
const { join } = require("path");
const fs = require("fs");

let pool;

function databaseInit() {
    const configPath = join(__dirname, '../config.json');
    const data = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(data);

    pool = mysql.createPool({
        host: config.sql.host,
        user: config.sql.user,
        password: config.sql.password,
        database: config.sql.database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    createTables();
}

async function createTables() {
    try {
        const connection = await pool.getConnection();

        const createRaidTableQuery = `
            CREATE TABLE IF NOT EXISTS raids (
                id INT AUTO_INCREMENT PRIMARY KEY,
                raid INT NOT NULL,
                player_1 VARCHAR(36) NOT NULL,
                player_2 VARCHAR(36) NOT NULL,
                player_3 VARCHAR(36) NOT NULL,
                player_4 VARCHAR(36) NOT NULL,
                time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reporter VARCHAR(36) NOT NULL,
                season_rating INT(5) DEFAULT 0 NOT NULL,
                guild_xp INT(11) DEFAULT 0 NOT NULL
            );
        `;

        await connection.execute(createRaidTableQuery);

        const createPlayerTableQuery = `
            CREATE TABLE IF NOT EXISTS players (
                uuid VARCHAR(36) NOT NULL PRIMARY KEY,
                username VARCHAR(16) NOT NULL
            );
        `;

        await connection.execute(createPlayerTableQuery);

        const createAspectTableQuery = `
            CREATE TABLE IF NOT EXISTS aspects (
                id INT AUTO_INCREMENT PRIMARY KEY,
                giver VARCHAR(36) NOT NULL,
                receiver VARCHAR(36) NOT NULL,
                time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reporter VARCHAR(36) NOT NULL
            );
        `;

        await connection.execute(createAspectTableQuery);

        connection.release();
    } catch (err) {
        console.error("Error creating table: ", err);
    }
}

async function insertRaid(raid, player1, player2, player3, player4, reporter, seasonRating, guildXP) {
    try {
        const connection = await pool.getConnection();

        const insertQuery = `
            INSERT INTO raids (raid, player_1, player_2, player_3, player_4, reporter, season_rating, guild_xp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        `;

        await connection.execute(insertQuery, [raid, player1, player2, player3, player4, reporter, seasonRating, guildXP]);
        connection.release();
    } catch (err) {
        console.error("Error inserting raid: ", err);
    }
}

async function insertAspect(giver, receiver, reporter) {
    try {
        const connection = await pool.getConnection();

        const insertQuery = `
            INSERT INTO aspects (giver, receiver, reporter)
            VALUES (?, ?, ?);
        `;

        await connection.execute(insertQuery, [giver, receiver, reporter]);
        connection.release();
    } catch (err) {
        console.error("Error inserting aspect: ", err);
    }
}

async function checkForRecentRaid(player) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT * FROM raids
            WHERE (player_1 = ? OR player_2 = ? OR player_3 = ? OR player_4 = ?)
            AND time > DATE_SUB(NOW(), INTERVAL 1 MINUTE);
        `;

        const [rows] = await connection.execute(query, [player, player, player, player]);
        connection.release();
        return rows.length > 0;
    } catch (err) {
        console.error("Error checking for recent raid: ", err);
    }

    return true;
}

async function getPlayerUUID(username) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT uuid FROM players
            WHERE username = ?;
        `;

        const [rows] = await connection.execute(query, [username]);
        connection.release();
        return rows[0].uuid;
    } catch (err) {
        return null;
    }
}

async function getPlayerUsername(uuid) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT username FROM players
            WHERE uuid = ?;
        `;

        const [rows] = await connection.execute(query, [uuid]);
        connection.release();
        return rows[0].username;
    } catch (err) {
        return null;
    }
}

async function insertPlayer(uuid, username) {
    try {
        const connection = await pool.getConnection();

        const insertQuery = `
            INSERT INTO players (uuid, username)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE username = VALUES(username);
        `;

        await connection.execute(insertQuery, [uuid, username]);
        connection.release();
    } catch (err) {
        console.error("Error inserting player: ", err);
    }
}

async function getRaids(uuid, days = -1) {
    try {
        const connection = await pool.getConnection();

        let query = `
            SELECT * FROM raids
            WHERE (player_1 = ? OR player_2 = ? OR player_3 = ? OR player_4 = ?)
        `;

        const params = [uuid, uuid, uuid, uuid];

        if (days > -1) {
            query += ` AND time > DATE_SUB(NOW(), INTERVAL ? DAY)`;
            params.push(days);
        }

        const [rows] = await connection.execute(query, params);
        connection.release();
        return rows;
    } catch (err) {
        console.error("Error getting raids: ", err);
    }

    return [];
}

async function getAspects(uuid) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT * FROM aspects
            WHERE receiver = ?;
        `;

        const [rows] = await connection.execute(query, [uuid]);
        connection.release();
        return rows;
    } catch (err) {
        console.error("Error getting aspects: ", err);
    }

    return [];
}

async function getOwedAspects() {
    try {
        let playerMap = new Map();

        const connection = await pool.getConnection();
        const query = `
            SELECT uuid FROM players;
        `;

        const [rows] = await connection.execute(query);

        for (const row of rows) {
            let uuid = row.uuid;
            let aspects = await getAspects(uuid);
            let raids = await getRaids(uuid);

            let totalAspects = aspects.length;
            let owedAspects = Math.max(Math.floor(raids.length / 2) - totalAspects, 0);

            playerMap.set(uuid, owedAspects);
        }

        connection.release();


        playerMap = new Map([...playerMap.entries()].sort((a, b) => b[1] - a[1]));

        let playerArray = [...playerMap.entries()];
        playerArray = playerArray.filter(([key, value]) => value > 0);
        playerMap = new Map(playerArray);

        return playerMap;
    } catch (err) {
        console.error("Error getting owed aspects: ", err);
    }

    return [];
}

async function getLeaderboard(raid, days = -1) {
    try {
        let playerMap = new Map();

        const connection = await pool.getConnection();
        const query = `
            SELECT uuid FROM players;
        `;

        const [rows] = await connection.execute(query);

        for (const row of rows) {
            let uuid = row.uuid;
            let raids = await getRaids(uuid, days);

            let raidCount = 0;
            for (const raidRow of raids) {
                if ( raid === -1 || raidRow.raid === raid) raidCount++;
            }

            playerMap.set(uuid, raidCount);
        }

        connection.release();

        playerMap = new Map([...playerMap.entries()].sort((a, b) => b[1] - a[1]));

        let leaderArray = [...playerMap.entries()];
        leaderArray = leaderArray.filter(([key, value]) => value > 0);
        playerMap = new Map(leaderArray);

        return playerMap;
    } catch (err) {
        console.error("Error getting leaderboard: ", err);
    }

    return [];
}

async function getGXPLeaderboard(days = -1) {
    try {
        let playerMap = new Map();

        const connection = await pool.getConnection();
        let query = `
            SELECT player_1, player_2, player_3, player_4, guild_xp FROM raids;
        `;

        const params = [];

        if (days > -1) {
            query += ` AND time > DATE_SUB(NOW(), INTERVAL ? DAY)`;
            params.push(days);
        }

        const [rows] = await connection.execute(query, params);

        for (const row of rows) {
            let uuid = row.uuid;
            let guildXP = row.guild_xp;

            if (row.player_1) playerMap.set(row.player_1, (playerMap.get(row.player_1) || 0) + guildXP);
            if (row.player_2) playerMap.set(row.player_2, (playerMap.get(row.player_2) || 0) + guildXP);
            if (row.player_3) playerMap.set(row.player_3, (playerMap.get(row.player_3) || 0) + guildXP);
            if (row.player_4) playerMap.set(row.player_4, (playerMap.get(row.player_4) || 0) + guildXP);
        }

        connection.release();

        playerMap = new Map([...playerMap.entries()].sort((a, b) => b[1] - a[1]));

        let leaderArray = [...playerMap.entries()];
        leaderArray = leaderArray.filter(([key, value]) => value > 0);
        playerMap = new Map(leaderArray);

        return playerMap;
    } catch (err) {
        console.error("Error getting leaderboard: ", err);
    }

    return [];
}

module.exports = { databaseInit, insertRaid, insertAspect, getGXPLeaderboard, getPlayerUUID,
    getPlayerUsername, insertPlayer, getRaids, getAspects, getOwedAspects, getLeaderboard };