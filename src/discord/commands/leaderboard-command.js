const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getPlayerUsername, getOwedAspects, getLeaderboard} = require("../../database");
const {raids} = require("../../misc");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Returns guild raid leaderboard rankings')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('The type of leaderboard to display')
                .setRequired(true)
                .addChoices(...getChoices())
        )
        .addStringOption(option =>
            option.setName('days')
                .setDescription('The time period to check for raids')
        ),
    async execute(interaction) {
        let days = interaction.options.getString('days');
        if (days) days = parseInt(days);

        let raid = interaction.options.getString('type');
        raid = parseInt(raid);

        let leaderData = await getLeaderboard(raid, (days) ? days : -1);
        let fields = [];

        for (const [uuid, raidCount] of leaderData) {
            let playerName = await getPlayerUsername(uuid);
            fields.push({ name: playerName, value: `\`\`\`${raidCount}\`\`\``});
        }

        const itemsPerPage = 10;
        const totalPages = Math.ceil(fields.length / itemsPerPage);

        const generateEmbed = (page) => {
            const start = page * itemsPerPage;
            const currentFields = fields.slice(start, start + itemsPerPage);

            return new EmbedBuilder()
                .setColor(0x0099FF)
                .setDescription("\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af\u23af")
                .setTitle(getRaidName(raid))
                .setAuthor({ name: 'Guild Raid Leaderboard' })
                .setDescription(`*${days ? `Last ${days} Day` + (days !== 1 ? "s" : "") : 'All Time'}*`)
                .addFields(...currentFields)
                .setFooter({ text: `Page ${page + 1} of ${totalPages}` });
        };

        let currentPage = 0;
        const embedMessage = await interaction.reply({ embeds: [generateEmbed(currentPage)], fetchReply: true });

        if (totalPages > 1) {
            const generateActionRow = (page) => {
                return new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('prev')
                            .setLabel('Previous')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(page === 0),
                        new ButtonBuilder()
                            .setCustomId('next')
                            .setLabel('Next')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(page === totalPages - 1)
                    );
            };

            await interaction.editReply({ components: [generateActionRow(currentPage)] });

            const filter = i => i.customId === 'prev' || i.customId === 'next';
            const collector = embedMessage.createMessageComponentCollector({ filter, time: 60000 });

            collector.on('collect', async i => {
                if (i.customId === 'prev' && currentPage > 0) currentPage--;
                else if (i.customId === 'next' && currentPage < totalPages - 1) currentPage++;

                await i.update({ embeds: [generateEmbed(currentPage)], components: [generateActionRow(currentPage)] });
            });

            collector.on('end', () => {
                interaction.editReply({ components: [] });
            });
        }
    },


};

function getChoices() {
    let choices = [];

    raids.forEach(raid => choices.push({ name: raid.name, value: `${raid.id}` }));

    return choices;
}

function getRaidName(raid) {
    return raids.find(r => r.id === raid).name;
}