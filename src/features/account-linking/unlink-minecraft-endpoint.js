const { config } = require('../../core/config');
const accountLinkingService = require('./account-linking-service');
const { requestUUID } = require('../../core/utilities');
const roleManager = require('./role-manager');
const { getToken } = require('../auth/authentication');

class UnlinkMinecraftEndpoint {
    async call(req, res) {
        try {
            // Expect token, and uuid as query parameters
            const { token, uuid } = req.query;

            if (!token || !uuid) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing authentication token or UUID'
                });
            }

            // Verify the authentication token for this UUID
            const tokenObject = await getToken(uuid);
            if (!tokenObject || tokenObject.serverId !== token || !tokenObject.isAuthenticated()) {
                return res.status(401).json({
                    success: false,
                    error: 'Invalid or expired authentication token'
                });
            }

            // Check if this Minecraft account is linked
            const existingLink = await accountLinkingService.getLinkByMinecraft(uuid);
            if (!existingLink) {
                return res.status(404).json({
                    success: false,
                    error: 'This Minecraft account is not linked to any Discord account'
                });
            }

            // Remove the link
            const success = accountLinkingService.unlinkByMinecraft(uuid);

            if (success) {
                // Try to remove linked role from Discord user
                try {
                    await roleManager.removeLinkedRole(existingLink.discord_id);
                } catch (roleError) {
                    console.error('Error removing linked role:', roleError);
                    // Don't fail the unlink if role removal fails
                }

                return res.status(200).json({
                    success: true,
                    message: `Minecraft account has been unlinked from Discord`,
                    discord_id: existingLink.discord_id
                });
            } else {
                return res.status(500).json({
                    success: false,
                    error: 'Failed to unlink account'
                });
            }

        } catch (error) {
            console.error('Error in unlink minecraft endpoint:', error);
            return res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        }
    }
}

module.exports = { UnlinkMinecraftEndpoint };