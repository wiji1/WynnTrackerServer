const { config } = require('../../core/config');

class RoleManager {
    constructor() {
        this._linkedRoleId = null;
        this.initialized = false;
        this.client = null; // Will be set by Discord bot
        this._ranks = null; // Cache rank configuration
    }

    // Getter methods for external access
    get linkedRoleId() {
        return this._linkedRoleId;
    }

    get ranks() {
        return this._ranks;
    }

    init(discordClient) {
        if (this.initialized) return;
        
        this.client = discordClient;
        
        // Get role ID from config
        this._linkedRoleId = config.get('account-linking.linked-role-id');
        this._ranks = config.get('ranks');
        
        // Cache guilds now that we have the client
        if (this.client && this.client.readyAt) {
            this.initialized = true;
        } else {
            console.warn('Discord client not ready for role manager initialization');
        }
    }

    /**
     * Add linked role to a Discord user
     * @param {string} discordId - Discord user ID
     * @returns {Promise<boolean>} Success status
     */
    async addLinkedRole(discordId) {
        if (!this._linkedRoleId) {
            console.log('No linked role ID configured, skipping role assignment');
            return true;
        }

        if (!this.initialized || !this.client) {
            console.warn('Role manager not initialized or client not available');
            return false;
        }

        try {
            // Try to find the user in any of the cached guilds
            for (const [guildId, guild] of this.client.guilds.cache) {
                try {
                    const member = await guild.members.fetch(discordId);
                    if (member) {
                        try {
                            await member.roles.add(this._linkedRoleId);
                            // After attempting to add, re-fetch the member to confirm the role is present
                            const updatedMember = await guild.members.fetch(discordId);
                            if (updatedMember.roles.cache.has(this._linkedRoleId)) {
                                console.log(`Added linked role to user ${discordId} in guild ${guild.name}`);
                                return true;
                            } else {
                                console.error(`Failed to add linked role ${this._linkedRoleId} to user ${discordId} in guild ${guild.name}`);
                                return false;
                            }
                        } catch (addRoleError) {
                            console.error(`Failed to add linked role ${this._linkedRoleId} to user ${discordId} in guild ${guild.name}:`, addRoleError);
                            return false;
                        }
                    }
                } catch (memberError) {
                    // User not in this guild, continue to next
                    continue;
                }
            }

            console.log(`User ${discordId} not found in any cached guilds!`);
            return false;

        } catch (error) {
            console.error(`Error adding linked role to user ${discordId}:`, error);
            return false;
        }
    }

    /**
     * Remove linked role from a Discord user
     * @param {string} discordId - Discord user ID
     * @returns {Promise<boolean>} Success status
     */
    async removeLinkedRole(discordId) {
        if (!this._linkedRoleId) {
            console.log('No linked role ID configured, skipping role removal');
            return true;
        }

        if (!this.initialized || !this.client) {
            console.warn('Role manager not initialized or client not available');
            return false;
        }

        try {
            // Try to find the user in any of the cached guilds
            for (const [guildId, guild] of this.client.guilds.cache) {
                try {
                    const member = await guild.members.fetch(discordId);
                    if (member) {
                        await member.roles.remove(this._linkedRoleId);
                        console.log(`Removed linked role from user ${discordId} in guild ${guild.name}`);
                        return true;
                    }
                } catch (memberError) {
                    // User not in this guild, continue to next
                    continue;
                }
            }

            console.log(`User ${discordId} not found in any cached guilds`);
            return false;

        } catch (error) {
            console.error(`Error removing linked role from user ${discordId}:`, error);
            return false;
        }
    }

    /**
     * Check if a user has the required role to use link commands
     * @param {string} discordId - Discord user ID
     * @returns {Promise<boolean>} Whether user has required role
     */
    async hasRequiredRole(discordId) {
        const requiredRoleId = config.get('account-linking.required-role-id');
        if (!requiredRoleId) {
            return true; // No required role configured, allow everyone
        }

        if (!this.initialized || !this.client) {
            console.warn('Role manager not initialized or client not available');
            return false;
        }

        try {
            // Try to find the user in any of the cached guilds
            for (const [guildId, guild] of this.client.guilds.cache) {
                try {
                    const member = await guild.members.fetch(discordId);
                    if (member) {
                        return member.roles.cache.has(requiredRoleId);
                    }
                } catch (memberError) {
                    // User not in this guild, continue to next
                    continue;
                }
            }

            return false; // User not found in any guild

        } catch (error) {
            console.error(`Error checking required role for user ${discordId}:`, error);
            return false;
        }
    }

    /**
     * Check if user has any rank role and assign recruit if they don't
     * @param {string} discordId - Discord user ID
     * @returns {Promise<boolean>} Success status
     */
    async ensureUserHasRank(discordId) {
        if (!this._ranks || !this.initialized || !this.client) {
            console.warn('Role manager not properly initialized for rank assignment');
            return false;
        }

        try {
            // Get all rank role IDs
            const rankRoleIds = Object.values(this._ranks).map(rank => rank['discord-role-id']);
            
            // Find the user in any guild
            for (const [guildId, guild] of this.client.guilds.cache) {
                try {
                    const member = await guild.members.fetch(discordId);
                    if (member) {
                        // Check if user has any rank role
                        const hasRankRole = member.roles.cache.some(role => rankRoleIds.includes(role.id));
                        
                        if (!hasRankRole) {
                            // Get recruit role ID
                            const recruitRoleId = this._ranks.recruit?.['discord-role-id'];
                            if (recruitRoleId) {
                                await member.roles.add(recruitRoleId);
                                console.log(`Assigned recruit role to user ${discordId} in guild ${guild.name}`);
                                return true;
                            } else {
                                console.warn('Recruit role not configured');
                                return false;
                            }
                        } else {
                            console.log(`User ${discordId} already has a rank role`);
                            return true;
                        }
                    }
                } catch (memberError) {
                    continue;
                }
            }

            console.log(`User ${discordId} not found in any cached guilds`);
            return false;

        } catch (error) {
            console.error(`Error ensuring user has rank role for ${discordId}:`, error);
            return false;
        }
    }
}

module.exports = new RoleManager();