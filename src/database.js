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
                reporter VARCHAR(36) NOT NULL
            );
        `;

        await connection.execute(createRaidTableQuery);

        const createPlayerTableQuery = `
            CREATE TABLE IF NOT EXISTS players (
                id INT AUTO_INCREMENT PRIMARY KEY,
                uuid VARCHAR(36) NOT NULL UNIQUE,
                username VARCHAR(16) NOT NULL
            );
        `;

        await connection.execute(createPlayerTableQuery);
        connection.release();
    } catch (err) {
        console.error("Error creating table: ", err);
    }
}

async function insertRaid(raid, player1, player2, player3, player4, reporter) {
    try {
        const connection = await pool.getConnection();

        const insertQuery = `
            INSERT INTO raids (raid, player_1, player_2, player_3, player_4, reporter)
            VALUES (?, ?, ?, ?, ?, ?);
        `;

        await connection.execute(insertQuery, [raid, player1, player2, player3, player4, reporter]);
        connection.release();
    } catch (err) {
        console.error("Error inserting raid: ", err);
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
            VALUES (?, ?);
        `;

        await connection.execute(insertQuery, [uuid, username]);
        connection.release();
    } catch (err) {
        console.error("Error inserting player: ", err);
    }
}

module.exports = { databaseInit, insertRaid, checkForRecentRaid, getPlayerUUID, getPlayerUsername, insertPlayer };