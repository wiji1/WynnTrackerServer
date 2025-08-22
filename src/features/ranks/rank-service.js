const { config } = require('../../core/config');
const accountLinkingService = require('../account-linking/account-linking-service');
const { wsManager } = require('../websocket/websocket');

class RankService {
    constructor() {
        this.ranks = config.get('ranks');
        this.discordClient = null;
        this.promotionQueue = new Map(); // requestId -> promotion request data
        this.pendingPromotions = new Map(); // requestId -> timeout and callback info
        this.retryQueue = new Map(); // requestId -> retry promotion data
        this.maxRetries = 10; // Maximum retry attempts
        this.retryInterval = 60000; // 1 minute between retries
        
        // Member cache for performance
        this.memberCache = new Map(); // discordId -> member data
        this.cacheExpiry = null;
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        
        this.startRetryTimer();
    }

    setDiscordClient(client) {
        this.discordClient = client;
        console.log(`Rank service Discord client set. Available guilds: ${client.guilds.cache.size}`);
        client.guilds.cache.forEach(guild => {
            console.log(`- Guild: ${guild.name} (${guild.id})`);
        });
    }

    /**
     * Get rank configuration by rank key
     * @param {string} rankKey - The rank key (e.g., 'recruit', 'member')
     * @returns {Object|null} Rank configuration or null
     */
    getRankConfig(rankKey) {
        return this.ranks[rankKey] || null;
    }

    /**
     * Get rank configuration by Discord role ID
     * @param {string} roleId - Discord role ID
     * @returns {Object|null} Rank configuration with key or null
     */
    getRankByRoleId(roleId) {
        for (const [key, rank] of Object.entries(this.ranks)) {
            if (rank['discord-role-id'] === roleId) {
                return { key, ...rank };
            }
        }
        return null;
    }

    /**
     * Get rank configuration by ingame rank number
     * @param {number} ingameRank - Ingame rank number (1-5)
     * @returns {Object|null} Rank configuration with key or null
     */
    getRankByIngameLevel(ingameRank) {
        for (const [key, rank] of Object.entries(this.ranks)) {
            if (rank['ingame-rank'] === ingameRank) {
                return { key, ...rank };
            }
        }
        return null;
    }

    /**
     * Get all rank configurations sorted by ingame rank
     * @returns {Array} Array of rank configs with keys
     */
    getAllRanks() {
        const rankArray = Object.entries(this.ranks).map(([key, rank]) => ({
            key,
            ...rank
        }));
        return rankArray.sort((a, b) => a['ingame-rank'] - b['ingame-rank']);
    }

    /**
     * Returns a random element from an array.
     * @param {Array} arr - The array to pick from.
     * @returns {*} A random element from the array.
     */
    getRandomElement(arr) {
        if (!Array.isArray(arr) || arr.length === 0) {
            return undefined;
        }
        const randomIndex = Math.floor(Math.random() * arr.length);
        return arr[randomIndex];
    }

    /**
     * Simple cache refresh using Discord.js guild cache (no API calls)
     */
    async refreshMemberCache() {
        if (!this.discordClient) return;

        try {
            const guild = this.discordClient.guilds.cache.first();
            if (!guild) {
                console.error('No guilds found in Discord client cache for refreshMemberCache');
                return;
            }

            console.log('Refreshing Discord member cache from guild cache...');
            
            // Use already cached guild members (no API call needed)
            this.memberCache.clear();
            const cachedMembers = guild.members.cache;
            
            for (const [discordId, member] of cachedMembers) {
                this.memberCache.set(discordId, {
                    id: member.id,
                    roles: Array.from(member.roles.cache.keys()),
                    displayName: member.displayName,
                    username: member.user.username
                });
            }
            
            // Set expiry
            this.cacheExpiry = Date.now() + this.cacheTimeout;
            console.log(`Cached ${this.memberCache.size} Discord members from guild cache`);
            
        } catch (error) {
            console.error('Error refreshing member cache:', error);
            // Set short expiry to retry soon
            this.cacheExpiry = Date.now() + 60000; // 1 minute
        }
    }

    /**
     * Check if cache is valid
     */
    isCacheValid() {
        return this.cacheExpiry && Date.now() < this.cacheExpiry;
    }

    /**
     * Get a Discord member's current rank
     * @param {string} discordId - Discord user ID
     * @returns {Object|null} Current rank config or null
     */
    async getMemberRank(discordId) {
        if (!this.discordClient) return null;

        try {
            // Check if we need to refresh cache
            if (!this.isCacheValid()) {
                await this.refreshMemberCache();
            }

            // Get member from cache
            const cachedMember = this.memberCache.get(discordId);
            if (!cachedMember) {
                // Member not found in cache, try individual fetch as fallback
                const guild = this.discordClient.guilds.cache.first();
                if (!guild) return null;

                try {
                    const member = await guild.members.fetch(discordId);
                    if (!member) return null;

                    // Cache this member for future use
                    this.memberCache.set(discordId, {
                        id: member.id,
                        roles: Array.from(member.roles.cache.keys()),
                        displayName: member.displayName,
                        username: member.user.username
                    });

                    return this.calculateMemberRank(Array.from(member.roles.cache.keys()));
                } catch (fetchError) {
                    console.error(`Failed to fetch member ${discordId}:`, fetchError);
                    return null;
                }
            }

            // Calculate rank from cached member data
            return this.calculateMemberRank(cachedMember.roles);
        } catch (error) {
            console.error('Error getting member rank:', error);
            return null;
        }
    }

    /**
     * Calculate member rank from role IDs
     * @param {Array} roleIds - Array of role IDs
     * @returns {Object|null} Highest rank config or null
     */
    calculateMemberRank(roleIds) {
        let highestRank = null;
        let highestIngameRank = 0;

        for (const roleId of roleIds) {
            const rankConfig = this.getRankByRoleId(roleId);
            if (rankConfig && rankConfig['ingame-rank'] > highestIngameRank) {
                highestRank = rankConfig;
                highestIngameRank = rankConfig['ingame-rank'];
            }
        }

        return highestRank;
    }

    /**
     * Get ranks for multiple Discord IDs efficiently (batch operation)
     * @param {Array} discordIds - Array of Discord user IDs
     * @returns {Map} Map of discordId -> rank data
     */
    async getBatchMemberRanks(discordIds) {
        const rankMap = new Map();
        
        if (!this.discordClient || discordIds.length === 0) {
            return rankMap;
        }

        try {
            // Ensure cache is fresh (this is now fast - no API calls)
            if (!this.isCacheValid()) {
                await this.refreshMemberCache();
            }

            // Process all Discord IDs from cache
            for (const discordId of discordIds) {
                const cachedMember = this.memberCache.get(discordId);
                if (cachedMember) {
                    const rank = this.calculateMemberRank(cachedMember.roles);
                    if (rank) {
                        rankMap.set(discordId, rank);
                    }
                } else {
                    // Try individual fetch for missing member (but with quick timeout)
                    try {
                        const member = await Promise.race([
                            this.discordClient.guilds.cache.first().members.fetch(discordId),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Quick fetch timeout')), 1000)
                            )
                        ]);

                        if (member) {
                            // Cache this member
                            this.memberCache.set(discordId, {
                                id: member.id,
                                roles: Array.from(member.roles.cache.keys()),
                                displayName: member.displayName,
                                username: member.user.username
                            });

                            // Calculate rank
                            const rank = this.calculateMemberRank(Array.from(member.roles.cache.keys()));
                            if (rank) {
                                rankMap.set(discordId, rank);
                            }
                        }
                    } catch (fetchError) {
                        // Silently skip missing members
                        console.warn(`Could not fetch member ${discordId}:`, fetchError.message);
                    }
                }
            }

            return rankMap;
        } catch (error) {
            console.error('Error getting batch member ranks:', error);
            return rankMap;
        }
    }

    /**
     * Fetch missing members individually
     */
    async fetchMissingMembers(discordIds, rankMap) {
        const guild = this.discordClient.guilds.cache.first();
        if (!guild) return;

        const fetchPromises = discordIds.map(async (discordId) => {
            try {
                const member = await Promise.race([
                    guild.members.fetch(discordId),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Individual fetch timeout')), 3000)
                    )
                ]);

                if (member) {
                    // Cache this member
                    this.memberCache.set(discordId, {
                        id: member.id,
                        roles: Array.from(member.roles.cache.keys()),
                        displayName: member.displayName,
                        username: member.user.username
                    });

                    // Calculate rank
                    const rank = this.calculateMemberRank(Array.from(member.roles.cache.keys()));
                    if (rank) {
                        rankMap.set(discordId, rank);
                    }
                }
            } catch (fetchError) {
                console.warn(`Failed to fetch member ${discordId}:`, fetchError.message);
            }
        });

        // Wait for all individual fetches (but don't fail if some timeout)
        await Promise.allSettled(fetchPromises);
    }

    /**
     * Set a Discord member's rank
     * @param {string} discordId - Discord user ID
     * @param {string} newRankKey - New rank key
     * @param {string} setterDiscordId - Discord ID of the person setting the rank
     * @returns {Object} Result object with success status and message
     */
    async setMemberRank(discordId, newRankKey, setterDiscordId) {
        if (!this.discordClient) {
            return { success: false, error: 'Discord client not available' };
        }

        const newRankConfig = this.getRankConfig(newRankKey);
        if (!newRankConfig) {
            return { success: false, error: `Invalid rank: ${newRankKey}` };
        }

        try {
            // Get the guild - use first available guild from cache
            const guild = this.discordClient.guilds.cache.first();
            if (!guild) {
                console.error('No guilds found in Discord client cache');
                return { success: false, error: 'No Discord server found. Bot may not be properly connected to a server.' };
            }

            // Get the target member
            let targetMember = await guild.members.fetch(discordId);
            if (!targetMember) {
                return { success: false, error: 'Target member not found' };
            }

            // Get the setter member to check admin permissions
            const setterMember = await guild.members.fetch(setterDiscordId);
            if (!setterMember) {
                return { success: false, error: 'Setter member not found' };
            }

            // Check if setter is an admin (bypass rank restrictions)
            const isAdmin = setterMember.permissions.has('Administrator');
            let setterRank = null;
            let canPromote = false;

            if (isAdmin) {
                canPromote = true;
                console.log(`Admin override: ${setterMember.displayName} promoting ${targetMember.displayName} to ${newRankConfig.identifier}`);
            } else {
                // Get the setter's rank to check permissions
                setterRank = await this.getMemberRank(setterDiscordId);
                if (!setterRank) {
                    return { success: false, error: 'You do not have a rank or admin permissions to set other members\' ranks' };
                }

                // Check if setter has permission to set this rank
                canPromote = this.canPromoteToRank(setterRank['ingame-rank'], newRankConfig['ingame-rank']);
                if (!canPromote) {
                    return { 
                        success: false, 
                        error: `You cannot promote someone to ${newRankConfig.identifier}. Your rank: ${setterRank.identifier}. Use admin permissions if available.` 
                    };
                }
            }

            // Check if target has linked Minecraft account first
            const targetAccountLink = await accountLinkingService.getLink(discordId);
            if (!targetAccountLink) {
                return { 
                    success: false, 
                    error: `Cannot set rank: ${targetMember.displayName} does not have a linked Minecraft account. Use /link first.`
                };
            }

            // Force fresh fetch to get the latest roles (including any just-added linked role)
            const freshMember = await guild.members.fetch(discordId, { force: true });
            
            // Get all role IDs we need to preserve (everything except rank roles)
            const allRankRoleIds = Object.values(this.ranks).map(rank => rank['discord-role-id']);
            const nonRankRoles = Array.from(freshMember.roles.cache.keys()).filter(roleId => 
                !allRankRoleIds.includes(roleId)
            );
            
            // Add the new rank role to the preserved roles
            const newRole = guild.roles.cache.get(newRankConfig['discord-role-id']);
            if (!newRole) {
                return { success: false, error: `Rank role not found: ${newRankConfig.identifier}` };
            }
            
            const finalRoles = [...nonRankRoles, newRankConfig['discord-role-id']];
            
            // Set all roles at once to avoid caching issues
            await freshMember.roles.set(finalRoles);

            // Update our cache directly with the known changes (immediate)
            if (this.memberCache.has(discordId)) {
                const cachedMember = this.memberCache.get(discordId);
                // Update the roles array to include the new role and remove old rank roles
                const allRankRoleIds = Object.values(this.ranks).map(rank => rank['discord-role-id']);
                let updatedRoles = cachedMember.roles.filter(roleId => !allRankRoleIds.includes(roleId));
                updatedRoles.push(newRankConfig['discord-role-id']);
                
                this.memberCache.set(discordId, {
                    ...cachedMember,
                    roles: updatedRoles
                });
            }

            // Send in-game promotion packet
            // For in-game promotion, we'll find the highest eligible rank available
            const promotionResult = await this.requestIngamePromotion(
                targetAccountLink.minecraft_uuid,
                targetAccountLink.minecraft_username,
                newRankConfig['ingame-rank'],
                isAdmin ? 6 : (setterRank ? setterRank['ingame-rank'] : 6) // Use max rank for admin or fallback
            );

            return {
                success: true,
                message: `Successfully updated ${targetMember.displayName} to ${newRankConfig.identifier}`,
                discordUpdated: true,
                ingamePromotionRequested: promotionResult.requested,
                promotionError: promotionResult.error
            };

        } catch (error) {
            console.error('Error setting member rank:', error);
            return { success: false, error: 'An error occurred while setting the rank' };
        }
    }

    /**
     * Check if a setter rank can promote to a target rank
     * @param {number} setterRank - Setter's ingame rank
     * @param {number} targetRank - Target ingame rank
     * @returns {boolean} Whether promotion is allowed
     */
    canPromoteToRank(setterRank, targetRank) {
        // Only ranks 5-6 can promote anyone
        if (setterRank < 5) {
            return false;
        }
        
        // Ranks 1-4 can be promoted by ranks 5-6
        if (targetRank >= 1 && targetRank <= 4) {
            return setterRank >= 5;
        }
        
        // Rank 5 can only be promoted by rank 6
        if (targetRank === 5) {
            return setterRank === 6;
        }
        
        // Rank 6 cannot be promoted via Discord (manually set only)
        if (targetRank === 6) {
            return false;
        }
        
        return false;
    }

    /**
     * Request in-game promotion from an eligible client
     * @param {string} targetUuid - Target player UUID
     * @param {string} targetUsername - Target player username
     * @param {number} newRank - New rank number
     * @param {number} requestorRank - Requestor's rank number (for logging only)
     * @returns {Promise<Object>} Result of promotion request
     */
    async requestIngamePromotion(targetUuid, targetUsername, newRank, requestorRank) {
        const requestId = `rank_${Date.now()}_${targetUuid.slice(-8)}`;
        
        try {
            // Find eligible clients to perform the promotion (exclude target player)
            const eligibleClients = await this.findEligiblePromoters(newRank, targetUuid);
            
            if (eligibleClients.length === 0) {
                // Add to queue for when eligible clients come online
                const queuedPromotion = {
                    targetUuid,
                    targetUsername,
                    newRank,
                    requestorRank,
                    requestId,
                    queuedAt: Date.now()
                };
                
                this.promotionQueue.set(requestId, queuedPromotion);
                console.log(`Promotion request queued: ${targetUsername} -> rank ${newRank} (no eligible clients online)`);
                
                return {
                    requested: false,
                    queued: true,
                    requestId: requestId,
                    error: 'No eligible clients online. Promotion queued for when someone connects.',
                    targetUsername,
                    newRank
                };
            }

            // Select a random eligible client
            const selectedClient = this.getRandomElement(eligibleClients);
            const promotionPacket = {
                type: 'rank_promotion_request',
                data: {
                    targetUuid: targetUuid,
                    targetUsername: targetUsername,
                    newRank: newRank,
                    promoterRank: selectedClient.rank,
                    requestorRank: requestorRank,
                    requestId: requestId
                }
            };

            // Send the request
            wsManager.sendToUuid(selectedClient.uuid, promotionPacket.type, promotionPacket.data);
            
            // Set up response tracking with timeout
            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    this.pendingPromotions.delete(requestId);
                    console.log(`Promotion request timeout: ${targetUsername} -> rank ${newRank}. Adding to retry queue.`);
                    
                    // Add to retry queue for automatic retries
                    this.addToRetryQueue({
                        requestId,
                        targetUuid,
                        targetUsername,
                        newRank,
                        requestorRank,
                        attempts: 0,
                        nextRetry: Date.now() + this.retryInterval
                    });
                    
                    resolve({
                        requested: true,
                        timedOut: true,
                        willRetry: true,
                        selectedPromoter: selectedClient.uuid,
                        selectedPromoterRank: selectedClient.rank,
                        error: 'In-game promotion timed out - will retry automatically every minute',
                        targetUsername,
                        newRank
                    });
                }, 30000); // 30 second timeout

                this.pendingPromotions.set(requestId, {
                    resolve,
                    timeout,
                    targetUuid,
                    targetUsername,
                    newRank,
                    selectedClient: selectedClient.uuid,
                    selectedPromoterRank: selectedClient.rank
                });

                console.log(`Rank promotion request sent to ${selectedClient.uuid} (rank ${selectedClient.rank}) for ${targetUsername} -> rank ${newRank}`);
                console.log(`Available eligible clients: ${eligibleClients.map(c => `${c.uuid.slice(-8)}(${c.rank})`).join(', ')}`);
            });

        } catch (error) {
            console.error('Error requesting in-game promotion:', error);
            return {
                requested: false,
                error: 'Failed to send promotion request',
                targetUsername,
                newRank
            };
        }
    }

    /**
     * Find eligible clients to perform a promotion
     * @param {number} targetRank - Target rank to promote to
     * @param {string|null} excludeUuid - UUID to exclude from eligible clients (e.g., the target player)
     * @returns {Promise<Array>} Array of eligible clients
     */
    async findEligiblePromoters(targetRank, excludeUuid = null) {
        const connectedClients = wsManager.getConnectedClients();
        const eligibleClients = [];

        for (const client of connectedClients) {
            if (!client.uuid) continue;

            // Skip if this is the target player (can't promote themselves)
            if (excludeUuid && client.uuid === excludeUuid) {
                continue;
            }

            try {
                //TODO: Add manual check for guild owner account

                // Get the client's rank through their account link
                const link = await accountLinkingService.getLinkByMinecraft(client.uuid);
                if (!link) continue;

                const clientRank = await this.getMemberRank(link.discord_id);
                if (!clientRank) continue;

                const clientIngameRank = clientRank['ingame-rank'];
                
                // Check if this client can perform the promotion
                if (this.canPromoteToRank(clientIngameRank, targetRank)) {
                    eligibleClients.push({
                        uuid: client.uuid,
                        discordId: link.discord_id,
                        rank: clientIngameRank,
                        clientId: client.id
                    });
                }
            } catch (error) {
                console.error(`Error checking eligibility for client ${client.uuid}:`, error);
                continue;
            }
        }

        return eligibleClients.sort((a, b) => b.rank - a.rank); // Highest ranks first
    }


    /**
     * Process queued promotions when clients connect
     * @param {string} clientUuid - UUID of newly connected client
     */
    async processQueueForClient(clientUuid) {
        if (this.promotionQueue.size === 0) return;

        try {
            // Get client's account link to determine their rank
            const link = await accountLinkingService.getLinkByMinecraft(clientUuid);
            if (!link) return;

            const clientRank = await this.getMemberRank(link.discord_id);
            if (!clientRank) return;

            const clientIngameRank = clientRank['ingame-rank'];
            console.log(`Processing promotion queue for newly connected client ${clientUuid} (rank ${clientIngameRank})`);

            // Check queued promotions that this client can handle
            for (const [requestId, queuedPromotion] of this.promotionQueue.entries()) {
                // Find all eligible clients for this specific queued promotion
                const eligiblePromotersForQueued = await this.findEligiblePromoters(queuedPromotion.newRank, queuedPromotion.targetUuid);

                // Filter to only include the currently connected client if it's eligible
                const currentClientAsEligible = eligiblePromotersForQueued.find(p => p.uuid === clientUuid);

                if (currentClientAsEligible) {
                    console.log(`Processing queued promotion: ${queuedPromotion.targetUsername} -> rank ${queuedPromotion.newRank}`);
                    
                    // Remove from queue
                    this.promotionQueue.delete(requestId);
                    
                    // Send the promotion request to the current client
                    const promotionPacket = {
                        type: 'rank_promotion_request',
                        data: {
                            targetUuid: queuedPromotion.targetUuid,
                            targetUsername: queuedPromotion.targetUsername,
                            newRank: queuedPromotion.newRank,
                            promoterRank: currentClientAsEligible.rank,
                            requestorRank: queuedPromotion.requestorRank,
                            requestId: queuedPromotion.requestId
                        }
                    };

                    wsManager.sendToUuid(clientUuid, promotionPacket.type, promotionPacket.data);
                    
                    // Set up response tracking
                    const timeout = setTimeout(() => {
                        this.pendingPromotions.delete(requestId);
                        console.log(`Queued promotion request timeout: ${queuedPromotion.targetUsername} -> rank ${queuedPromotion.newRank}`);
                    }, 30000);

                    this.pendingPromotions.set(requestId, {
                        resolve: () => {}, // No promise to resolve for queued items
                        timeout,
                        targetUuid: queuedPromotion.targetUuid,
                        targetUsername: queuedPromotion.targetUsername,
                        newRank: queuedPromotion.newRank,
                        selectedClient: clientUuid,
                        selectedPromoterRank: currentClientAsEligible.rank
                    });

                    console.log(`Queued promotion request sent to ${clientUuid} (rank ${currentClientAsEligible.rank})`);
                    break; // Process one at a time
                }
            }
        } catch (error) {
            console.error('Error processing promotion queue:', error);
        }
    }

    /**
     * Add a promotion to the retry queue
     * @param {Object} retryData - Retry data object
     */
    addToRetryQueue(retryData) {
        this.retryQueue.set(retryData.requestId, retryData);
        console.log(`Added to retry queue: ${retryData.targetUsername} -> rank ${retryData.newRank} (attempt ${retryData.attempts + 1})`);
    }

    /**
     * Start the retry timer that processes retry queue every minute
     */
    startRetryTimer() {
        setInterval(async () => {
            await this.processRetryQueue();
        }, this.retryInterval);
        console.log('Rank promotion retry timer started (1 minute interval)');
    }

    /**
     * Process the retry queue - attempt failed promotions
     */
    async processRetryQueue() {
        if (this.retryQueue.size === 0) return;

        console.log(`Processing retry queue: ${this.retryQueue.size} items`);
        const now = Date.now();

        for (const [requestId, retryData] of this.retryQueue.entries()) {
            // Check if it's time to retry
            if (now < retryData.nextRetry) continue;

            try {
                // Verify target is still eligible for this rank before retrying
                const targetAccountLink = await accountLinkingService.getLinkByMinecraft(retryData.targetUuid);
                if (!targetAccountLink) {
                    console.log(`Target ${retryData.targetUsername} no longer has linked account. Removing from retry queue.`);
                    this.retryQueue.delete(requestId);
                    continue;
                }

                // Find eligible clients to retry the promotion (exclude target player)
                const eligibleClients = await this.findEligiblePromoters(retryData.newRank, retryData.targetUuid);
                
                if (eligibleClients.length === 0) {
                    // No eligible clients, schedule next retry
                    retryData.nextRetry = now + this.retryInterval;
                    console.log(`No eligible clients for retry: ${retryData.targetUsername} -> rank ${retryData.newRank}. Will retry later.`);
                    continue;
                }

                // Select a random client and send retry request
                const selectedClient = this.getRandomElement(eligibleClients);
                const promotionPacket = {
                    type: 'rank_promotion_request',
                    data: {
                        targetUuid: retryData.targetUuid,
                        targetUsername: retryData.targetUsername,
                        newRank: retryData.newRank,
                        promoterRank: selectedClient.rank,
                        requestorRank: retryData.requestorRank,
                        requestId: retryData.requestId,
                        isRetry: true,
                        retryAttempt: retryData.attempts + 1
                    }
                };

                wsManager.sendToUuid(selectedClient.uuid, promotionPacket.type, promotionPacket.data);

                // Update retry data
                retryData.attempts++;
                retryData.nextRetry = now + this.retryInterval;
                
                // Set up response tracking for retry
                const timeout = setTimeout(() => {
                    this.pendingPromotions.delete(requestId);
                    console.log(`Retry ${retryData.attempts} timeout: ${retryData.targetUsername} -> rank ${retryData.newRank}`);
                }, 30000);

                this.pendingPromotions.set(requestId, {
                    resolve: () => {}, // No promise to resolve for retries
                    timeout,
                    targetUuid: retryData.targetUuid,
                    targetUsername: retryData.targetUsername,
                    newRank: retryData.newRank,
                    selectedClient: selectedClient.uuid,
                    selectedPromoterRank: selectedClient.rank,
                    isRetry: true
                });

                console.log(`Retry ${retryData.attempts} sent to ${selectedClient.uuid} for ${retryData.targetUsername} -> rank ${retryData.newRank}`);

            } catch (error) {
                console.error(`Error processing retry for ${retryData.targetUsername}:`, error);
                retryData.nextRetry = now + this.retryInterval;
            }
        }
    }

    /**
     * Handle promotion response from client (updated for retry support)
     * @param {string} requestId - The request ID
     * @param {boolean} success - Whether the promotion succeeded
     * @param {string|null} error - Error message if failed
     */
    handlePromotionResponse(requestId, success, error = null) {
        const pendingPromotion = this.pendingPromotions.get(requestId);
        if (!pendingPromotion) {
            console.warn(`Received response for unknown promotion request: ${requestId}`);
            return;
        }

        // Clear timeout and remove from pending
        clearTimeout(pendingPromotion.timeout);
        this.pendingPromotions.delete(requestId);

        if (success) {
            // Remove from retry queue if successful
            if (this.retryQueue.has(requestId)) {
                const retryData = this.retryQueue.get(requestId);
                this.retryQueue.delete(requestId);
                console.log(`✅ Retry successful: ${retryData.targetUsername} promoted to rank ${retryData.newRank} after ${retryData.attempts + 1} attempts`);
            } else {
                console.log(`✅ In-game promotion completed: ${pendingPromotion.targetUsername} -> rank ${pendingPromotion.newRank}`);
            }
        } else {
            // Failed response - if it was a retry, it will continue retrying
            if (pendingPromotion.isRetry) {
                console.error(`❌ Retry ${this.retryQueue.get(requestId)?.attempts || '?'} failed: ${pendingPromotion.targetUsername} -> rank ${pendingPromotion.newRank}: ${error}`);
            } else {
                // First attempt failed - add to retry queue
                console.error(`❌ Initial promotion failed: ${pendingPromotion.targetUsername} -> rank ${pendingPromotion.newRank}: ${error}. Adding to retry queue.`);
                this.addToRetryQueue({
                    requestId,
                    targetUuid: pendingPromotion.targetUuid,
                    targetUsername: pendingPromotion.targetUsername,
                    newRank: pendingPromotion.newRank,
                    requestorRank: 6, // Fallback rank
                    attempts: 0,
                    nextRetry: Date.now() + this.retryInterval
                });
            }
        }

        // Resolve the original promise if it exists
        if (pendingPromotion.resolve && typeof pendingPromotion.resolve === 'function') {
            pendingPromotion.resolve({
                requested: true,
                completed: success,
                selectedPromoter: pendingPromotion.selectedClient,
                selectedPromoterRank: pendingPromotion.selectedPromoterRank,
                targetUsername: pendingPromotion.targetUsername,
                newRank: pendingPromotion.newRank,
                error: success ? null : error
            });
        }
    }

    /**
     * Get queue status
     * @returns {Object} Queue information
     */
    getQueueStatus() {
        return {
            queuedPromotions: this.promotionQueue.size,
            pendingPromotions: this.pendingPromotions.size,
            retryPromotions: this.retryQueue.size
        };
    }
}

const rankService = new RankService();

module.exports = { RankService, rankService };