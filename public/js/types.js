/**
 * @file Type definitions for ALtoy
 * JSDoc typedefs for core data structures used across the application.
 * This file is documentation-only and contains no executable code.
 */

// ============================================
// ISLAND DATA TYPES
// ============================================

/**
 * @typedef {Object} IslandItem
 * @property {string} name - Item name (Korean)
 * @property {string} [icon] - Icon path fragment
 * @property {number} [type] - Item type identifier
 * @property {number} [rarity] - Rarity level
 * @property {number} [sell_price] - Sell price in gold
 */

/**
 * @typedef {Object} IslandRecipe
 * @property {number|string} id - Recipe ID
 * @property {string} name - Recipe name
 * @property {number} item_id - Output item ID
 * @property {number} workload - Work time in deciseconds
 * @property {number} ship_exp - Experience gained
 * @property {number} stamina_cost - Stamina cost
 * @property {Array<[number, number]>} commission_cost - Input materials [[itemId, quantity], ...]
 * @property {Array<[number, number]>} commission_product - Output products [[itemId, quantity], ...]
 * @property {Array<[number, number]>} [cost] - Manual mode input materials (category 1 only)
 * @property {Array<[number, number]>} [drop_display] - Manual mode output display
 * @property {number} production_limit - Max production per cycle
 * @property {boolean} [_isSeasonalView] - Whether this is a seasonal item view
 * @property {number} [_seasonalItemId] - Seasonal item ID
 * @property {boolean} [_isPickup] - Whether this is a pickup item
 * @property {boolean} [_isShop] - Whether this is purchasable from shop
 * @property {number[]} [_allRecipes] - All recipe IDs that produce this seasonal item
 */

/**
 * @typedef {Object} IslandCharacter
 * @property {number} id - Character ID
 * @property {string} name - Character name
 * @property {number} power - Power level
 * @property {Array<[number, number]>} base_att - Base attributes [[attrId, value], ...]
 * @property {Array<[number, number[]]>} growth_att - Growth attributes [[attrId, values], ...]
 * @property {string} [icon] - Icon URL
 */

/**
 * @typedef {Object} DependencyGraph
 * @property {Object<string, number[]>} producedBy - itemId -> recipe IDs that produce it
 * @property {Object<string, number[]>} usedBy - itemId -> recipe IDs that use it
 */

/**
 * @typedef {Object} DependencyTreeNode
 * @property {IslandRecipe} recipe - The recipe at this node
 * @property {number|string} recipeId - Recipe ID
 * @property {string} category - Category ID
 * @property {number} quantityMultiplier - How many times to run this recipe
 * @property {DependencyTreeNode[]} dependencies - Child dependencies
 * @property {boolean} isManualMode - Whether using manual mode
 */

// ============================================
// SHIP DATA TYPES
// ============================================

/**
 * @typedef {Object} ShipData
 * @property {number} sid - Ship ID
 * @property {string} name - Ship name (Korean)
 * @property {string} [name_en] - Ship name (English)
 * @property {number} rarity - Rarity level (1-6)
 * @property {string} type - Ship type code
 * @property {string} nationality - Nationality code
 * @property {string} [shipyard] - Shipyard icon URL
 * @property {Object} [stats] - Ship stats object
 * @property {Array} [skills] - Skill data array
 * @property {Object} [gifts] - Gift preferences
 */

/**
 * @typedef {Object} ShipDataLite
 * @property {number} sid - Ship ID
 * @property {string} name - Ship name
 * @property {number} rarity - Rarity level
 * @property {string} type - Ship type code
 * @property {string} nationality - Nationality code
 */

// ============================================
// SKIN DATA TYPES
// ============================================

/**
 * @typedef {Object} SkinData
 * @property {string} id - Skin ID
 * @property {string} 한글 함순이 + 스킨 이름 - Korean ship name + skin name
 * @property {string} 함순이 이름 - Ship name
 * @property {string} 클뜯 id - Client ID
 * @property {string} [스킨 이름] - Skin name
 * @property {Object} [voicelines] - Voice line data
 */

// ============================================
// STORY DATA TYPES
// ============================================

/**
 * @typedef {Object} StoryEvent
 * @property {string} id - Event ID
 * @property {string} name - Event name
 * @property {string} [thumbnail] - Thumbnail URL
 * @property {StoryMemory[]} memories - Array of memories/chapters
 */

/**
 * @typedef {Object} StoryMemory
 * @property {string} id - Memory ID
 * @property {string} name - Memory/chapter name
 * @property {StoryLine[]} script - Array of script lines
 */

/**
 * @typedef {Object} StoryLine
 * @property {string} [actor] - Actor ID
 * @property {string} [name] - Speaker name
 * @property {string} [content] - Dialogue content
 * @property {string} [bg] - Background image URL
 * @property {string} [bgm] - Background music ID
 * @property {string} [painting] - Character painting ID
 * @property {number} [painting_fadein] - Fade-in duration
 * @property {Array} [options] - Dialogue choices
 * @property {string} [optionFlag] - Option flag for branching
 */

// ============================================
// CHAT DATA TYPES
// ============================================

/**
 * @typedef {Object} ChatMessage
 * @property {string} [speaker] - Speaker ID
 * @property {string} [name] - Speaker name
 * @property {string} [content] - Message content
 * @property {string} [image] - Image URL
 * @property {boolean} [isPlayer] - Whether this is a player message
 */

// ============================================
// CACHE TYPES
// ============================================

/**
 * @typedef {Object} CacheEntry
 * @property {string} url - Cache key (URL)
 * @property {*} data - Cached data
 * @property {number} timestamp - Cache time (ms since epoch)
 */

/**
 * @typedef {Object} CacheOptions
 * @property {number} [maxAge=86400000] - Cache duration in ms (default: 24 hours)
 * @property {boolean} [forceRefresh=false] - Skip cache and fetch fresh data
 */
