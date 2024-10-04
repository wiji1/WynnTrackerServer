const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const axios = require('axios');
const {getPlayerUUID, getRaids, getPlayerUsername, getAspects, getGuild} = require("../../database");
const {join} = require("path");
const fs = require("fs");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aspects')
        .setDescription('Returns data on the given player\'s received guild aspects')
        .addStringOption(option =>
            option.setName('player')
                .setDescription('The name of the player')
                .setRequired(true)),
    async execute(interaction) {
        let playerName = interaction.options.getString('player');
        let uuid = await getPlayerUUID(playerName);

        if (!uuid) {
            await interaction.reply(`Unable to find player with the name ${playerName}`);
            return;
        }

        let guild = await getGuild(uuid);
        const configPath = join(__dirname, '../../../config.json');
        const data = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(data);

        if (!guild || guild !== config["guild-tag"]) {
            await interaction.reply(`Player is not in the guild`);
            return;
        }

        playerName = await getPlayerUsername(uuid);

        let aspectData = await getAspects(uuid);
        let raidData = await getRaids(uuid);

        let totalAspects = aspectData.length;
        let owedAspects = Math.max(Math.floor(raidData.length / 2) - totalAspects, 0);

        const response = await axios.get(`https://crafatar.com/renders/head/${uuid}?overlay=true`, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');
        const attachment = new AttachmentBuilder(buffer, { name: 'thumbnail.png' });

        const exampleEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setAuthor({ name: 'Player Guild Aspects' })
            .setTitle(`**${playerName}**`)
            .setThumbnail('attachment://thumbnail.png')
            .addFields(
                { name: '\u200B', value: '\u200B' },
                { name: 'Total Raids Completed', value: `\`\`\`${raidData.length}\`\`\`` },
                { name: "Aspects Given", value: `\`\`\`${totalAspects}\`\`\``},
                { name: 'Owed Aspects', value: `\`\`\`${owedAspects}\`\`\``},
            )

        await interaction.reply({ embeds: [exampleEmbed], files: [attachment] });
    },
};