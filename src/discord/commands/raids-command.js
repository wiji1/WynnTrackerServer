const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const axios = require('axios');
const {getPlayerUUID, getRaids, getPlayerUsername} = require("../../database");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('raids')
        .setDescription('Returns data on the given player\'s completed guild raids')
        .addStringOption(option =>
            option.setName('player')
                .setDescription('The name of the player')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('days')
                .setDescription('The time period to check for raids')
        ),
    async execute(interaction) {
        let playerName = interaction.options.getString('player');
        let uuid = await getPlayerUUID(playerName);

        let days = interaction.options.getString('days');
        if (days) days = parseInt(days);

        if (!uuid) {
            await interaction.reply(`Unable to find player with the name ${playerName}`);
            return;
        }

        playerName = await getPlayerUsername(uuid);

        let raidCounts = [0, 0, 0, 0]
        let raidsData = await getRaids(uuid, (days) ? days : -1);
        for (let i = 0; i < raidsData.length; i++) {
            let raidIndex = raidsData[i].raid;
            raidCounts[raidIndex]++;
        }

        const response = await axios.get(`https://crafatar.com/renders/head/${uuid}?overlay=true`, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');
        const attachment = new AttachmentBuilder(buffer, { name: 'thumbnail.png' });

        const exampleEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setAuthor({ name: 'Player Guild Raid Stats' })
            .setTitle(`**${playerName}**`)
            .setThumbnail('attachment://thumbnail.png')
            .setDescription(`*${days ? `Last ${days} Day` + (days !== 1 ? "s" : "") : 'All Time'}*`)
            .addFields(
                { name: '\u200B', value: '\u200B' },
                { name: 'Nest of the Grootslangs', value: `\`\`\`Completions: ${raidCounts[0].toString()}   \`\`\``, inline: true },
                { name: "Orphion's Nexus of Light", value: `\`\`\`Completions: ${raidCounts[1].toString()}   \`\`\``, inline: true },
                { name: '\u200B', value: '\u200B'},
                { name: 'The Canyon Colossus', value: `\`\`\`Completions: ${raidCounts[2].toString()}   \`\`\``, inline: true },
                { name: 'The Nameless Anomaly', value: `\`\`\`Completions: ${raidCounts[3].toString()}   \`\`\``, inline: true }
            )

        await interaction.reply({ embeds: [exampleEmbed], files: [attachment] });
    },
};