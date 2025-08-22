const { config } = require('../../core/config');
const accountLinkingService = require('./account-linking-service');
const roleManager = require('./role-manager');
const { rankService } = require('../ranks/rank-service');
const { getToken } = require('../auth/authentication');

class VerifyLinkEndpoint {
    async call(req, res) {
        try {
            const { code, token, uuid } = req.query;

            const validationError = this.validateRequest(code, token, uuid);
            if (validationError) {
                return res.status(400).json(validationError);
            }

            const authValid = await this.validateAuthentication(uuid, token);
            if (!authValid) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid or expired authentication token'
                });
            }

            const result = await accountLinkingService.verifyLinkWithAuth(code, uuid);

            if (result.success) {
                await this.handleSuccessfulLink(result.link);

                return res.status(200).json({
                    success: true,
                    message: 'Account successfully linked!',
                    discord_id: result.link.discordId,
                    minecraft_username: result.link.minecraftUsername
                });
            }

            return res.status(400).json({
                success: false,
                error: result.error
            });

        } catch (error) {
            console.error('Error in verify link endpoint:', error);
            return res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }

    validateRequest(code, token, uuid) {
        if (!code) return { success: false, error: 'Missing verification code' };
        if (!token || !uuid) return { success: false, error: 'Missing authentication token or UUID' };

        return null;
    }

    async validateAuthentication(uuid, token) {
        const tokenObject = await getToken(uuid);
        return tokenObject && tokenObject.serverId === token && tokenObject.isAuthenticated();
    }

    async handleSuccessfulLink(link) {
        try {
            // Do everything atomically - add linked role and ensure rank in one operation
            await this.atomicRoleAssignment(link);
            // Skip assignInGameRank - it's handled in atomicRoleAssignment
            await rankService.refreshMemberCache();
        } catch (error) {
            console.error('Error in post-link setup:', error);
        }
    }

    async atomicRoleAssignment(link) {
        const discordClient = rankService.discordClient;
        if (!discordClient) {
            console.warn('Discord client not available for atomic role assignment');
            return;
        }

        const guild = discordClient.guilds.cache.first();
        if (!guild) {
            console.warn('No guild found for atomic role assignment');
            return;
        }

        try {
            const member = await guild.members.fetch(link.discordId, { force: true });
            const linkedRoleId = roleManager.linkedRoleId;
            const ranks = roleManager.ranks;
            
            if (!linkedRoleId) {
                console.warn('No linked role configured');
                return;
            }

            // Get current roles
            const currentRoles = Array.from(member.roles.cache.keys());
            
            // Check if user has any rank roles
            const allRankRoleIds = Object.values(ranks).map(rank => rank['discord-role-id']);
            const hasRankRole = currentRoles.some(roleId => allRankRoleIds.includes(roleId));
            
            // Build final role set: current roles + linked role + recruit role (if needed)
            let finalRoles = [...currentRoles];
            
            // Add linked role if not already present
            if (!finalRoles.includes(linkedRoleId)) {
                finalRoles.push(linkedRoleId);
            }
            
            // Add recruit role if user has no rank roles
            if (!hasRankRole) {
                const recruitRoleId = ranks.recruit?.['discord-role-id'];
                if (recruitRoleId && !finalRoles.includes(recruitRoleId)) {
                    finalRoles.push(recruitRoleId);
                }
            }
            
            await member.roles.set(finalRoles);
            console.log(`Account successfully linked and roles assigned for ${link.discordId}`);
            
        } catch (error) {
            console.error('Error in atomic role assignment:', error);
        }
    }

    async assignInGameRank(link) {
        try {
            const discordClient = rankService.discordClient;
            if (!discordClient) return;

            const guild = discordClient.guilds.cache.first();
            if (!guild) return;

            const member = await guild.members.fetch(link.discordId);
            if (!member) return;

            const highestRank = rankService.calculateMemberRank(Array.from(member.roles.cache.keys()));
            if (highestRank) {
                const botDiscordId = discordClient.user.id;
                await rankService.setMemberRank(link.discordId, highestRank.key, botDiscordId);
            }
        } catch (error) {
            console.error('Error assigning in-game rank:', error);
        }
    }
}

module.exports = { VerifyLinkEndpoint };