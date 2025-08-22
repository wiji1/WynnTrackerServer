const { config } = require('../../core/config');
const accountLinkingService = require('./account-linking-service');
const roleManager = require('./role-manager');
const { rankService } = require('../ranks/rank-service');
const { validateToken } = require('../auth/authentication');

class VerifyLinkEndpoint {
    async call(req, res) {
        try {
            // Expect verification code and token as query parameters
            const { code, token, uuid } = req.query;

            if (!code) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing verification code'
                });
            }

            if (!token || !uuid) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing authentication token or UUID'
                });
            }

            // Verify the authentication token for this UUID
            const validation = validateToken(token);
        
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid or expired authentication token'
                });
            }

            // Ensure the token belongs to the reporter UUID
            if (validation.uuid !== reporter) {
                return res.status(400).json({
                    success: false,
                    error: 'Token does not match reporter UUI'
                });
            }

            // Verify the account link with additional UUID validation
            const result = await accountLinkingService.verifyLinkWithAuth(code, uuid);

            if (result.success) {
                // Try to assign linked role and ensure user has a rank role
                try {
                    const linkedRoleAdded = await roleManager.addLinkedRole(result.link.discordId);
                    if (!linkedRoleAdded) {
                        console.warn(`Linked role was not added for user ${result.link.discordId}. Check logs for details.`);
                    }
                    // Introduce a small delay to avoid potential race conditions with Discord API
                    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
                    await roleManager.ensureUserHasRank(result.link.discordId);

                    // After roles are assigned, determine and set the in-game rank
                    try {
                        const discordClient = rankService.discordClient;
                        if (discordClient) {
                            const guild = discordClient.guilds.cache.first();
                            if (guild) {
                                const member = await guild.members.fetch(result.link.discordId);
                                if (member) {
                                    const highestRank = rankService.calculateMemberRank(Array.from(member.roles.cache.keys()));
                                    if (highestRank) {
                                        console.log(`Setting in-game rank for ${result.link.minecraftUsername} to ${highestRank.identifier} based on Discord roles.`);
                                        // Use the bot's own ID as the setterDiscordId for automated rank assignment
                                        const botDiscordId = discordClient.user.id;
                                        await rankService.setMemberRank(result.link.discordId, highestRank.key, botDiscordId);
                                    } else {
                                        console.log(`No applicable in-game rank found for ${result.link.minecraftUsername} based on Discord roles.`);
                                    }
                                } else {
                                    console.warn(`Could not fetch Discord member ${result.link.discordId} for rank assignment.`);
                                }
                            } else {
                                console.warn('No Discord guild found in cache for rank assignment.');
                            }
                        } else {
                            console.warn('Discord client not available in rankService for rank assignment.');
                        }
                    } catch (rankAssignmentError) {
                        console.error('Error assigning in-game rank after linking:', rankAssignmentError);
                        // Don't fail the verification if rank assignment fails
                    }
                    
                    // Refresh the member cache immediately to include the newly linked user
                    await rankService.refreshMemberCache();
                } catch (roleError) {
                    console.error('Error assigning roles or refreshing cache:', roleError);
                    // Don't fail the verification if role assignment fails
                }

                return res.status(200).json({
                    success: true,
                    message: 'Account successfully linked!',
                    discord_id: result.link.discordId,
                    minecraft_username: result.link.minecraftUsername
                });
            } else {
                return res.status(400).json({
                    success: false,
                    error: result.error
                });
            }

        } catch (error) {
            console.error('Error in verify link endpoint:', error);
            return res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }
}

module.exports = { VerifyLinkEndpoint };