/**
 * processVote — Cloud Function for Azur Lane skin poll voting.
 *
 * Triggered when a document is created in `vote_queue/{voteId}`.
 * Validates the vote, runs a Firestore transaction to update aggregates
 * and user vote records, then updates the leaderboard.
 *
 * Architecture:
 *   Client creates doc in vote_queue → this function processes it →
 *   updates metadata/all_poll_results + user_votes/{userId} →
 *   recomputes metadata/leaderboard
 */

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();

// --- Constants ---
const MIN_VOTES_FOR_LEADERBOARD = 10;
const LEADERBOARD_SIZE = 10;

/**
 * Validates that the vote document has all required fields with correct types.
 * @param {object} data - The vote document data
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateVote(data) {
    if (!data) {
        return { valid: false, reason: "Vote document is empty" };
    }

    const { userId, clientId, rating, skinName, characterName } = data;

    if (!userId || typeof userId !== "string") {
        return { valid: false, reason: "Missing or invalid userId" };
    }
    if (!clientId || typeof clientId !== "string") {
        return { valid: false, reason: "Missing or invalid clientId" };
    }
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return { valid: false, reason: `Invalid rating: ${rating} (must be integer 1-5)` };
    }
    if (!skinName || typeof skinName !== "string") {
        return { valid: false, reason: "Missing or invalid skinName" };
    }
    if (!characterName || typeof characterName !== "string") {
        return { valid: false, reason: "Missing or invalid characterName" };
    }

    return { valid: true };
}

/**
 * Recomputes the leaderboard from the current all_poll_results document.
 * Only writes if the leaderboard has actually changed.
 * This is non-critical — eventual consistency is acceptable.
 */
async function updateLeaderboard() {
    try {
        const resultsSnap = await db.doc("metadata/all_poll_results").get();
        const allResults = resultsSnap.exists ? resultsSnap.data() : {};

        // Filter skins with enough votes, sort by average desc (tiebreak: total_votes desc)
        const ranked = Object.entries(allResults)
            .filter(([, info]) => info && info.total_votes >= MIN_VOTES_FOR_LEADERBOARD)
            .sort((a, b) => {
                const avgDiff = b[1].average_score - a[1].average_score;
                if (avgDiff !== 0) return avgDiff;
                return b[1].total_votes - a[1].total_votes;
            })
            .slice(0, LEADERBOARD_SIZE)
            .map(([clientId, info]) => ({
                clientId,
                skin_name: info.skin_name,
                character_name: info.character_name,
                average_score: info.average_score,
                total_votes: info.total_votes,
            }));

        // Compute total votes across ALL skins (not just leaderboard)
        const totalVotes = Object.values(allResults)
            .reduce((sum, info) => sum + (info?.total_votes || 0), 0);

        // Read current leaderboard to check if update is needed
        const leaderboardSnap = await db.doc("metadata/leaderboard").get();
        const currentData = leaderboardSnap.exists ? leaderboardSnap.data() : null;

        // Compare: only write if the leaderboard array changed
        const newLeaderboardJSON = JSON.stringify(ranked);
        const currentLeaderboardJSON = currentData
            ? JSON.stringify(currentData.leaderboard || [])
            : null;

        if (newLeaderboardJSON === currentLeaderboardJSON && currentData?.totalVotes === totalVotes) {
            logger.info("Leaderboard unchanged, skipping write");
            return;
        }

        await db.doc("metadata/leaderboard").set({
            leaderboard: ranked,
            totalVotes,
            lastUpdated: FieldValue.serverTimestamp(),
        });

        logger.info(`Leaderboard updated: ${ranked.length} entries, ${totalVotes} total votes`);
    } catch (error) {
        // Non-critical — log and move on
        logger.error("Failed to update leaderboard:", error);
    }
}

/**
 * processVote — triggered on vote_queue/{voteId} document creation.
 *
 * 1. Validates the vote data
 * 2. Runs a transaction to deduplicate and update aggregates + user votes
 * 3. Deletes the processed queue document
 * 4. Updates the leaderboard (non-critical, outside transaction)
 */
exports.processVote = onDocumentCreated(
    {
        document: "vote_queue/{voteId}",
        region: "asia-northeast3",
        maxInstances: 10,
    },
    async (event) => {
        const voteId = event.params.voteId;
        const data = event.data?.data();

        logger.info(`Processing vote: ${voteId}`);

        // --- Step 1: Validate ---
        const validation = validateVote(data);
        if (!validation.valid) {
            logger.warn(`Invalid vote ${voteId}: ${validation.reason}`);
            // Delete invalid queue doc so it doesn't pile up
            await db.doc(`vote_queue/${voteId}`).delete();
            return;
        }

        const { userId, clientId, rating, skinName, characterName } = data;

        // --- Step 2: Transaction (deduplicate + update aggregates + record vote) ---
        let isDuplicate = false;

        try {
            await db.runTransaction(async (transaction) => {
                const userVotesRef = db.doc(`user_votes/${userId}`);
                const allResultsRef = db.doc("metadata/all_poll_results");

                // Read phase
                const userVotesSnap = await transaction.get(userVotesRef);
                const allResultsSnap = await transaction.get(allResultsRef);

                // Duplicate check: does this user already have a vote for this clientId?
                const userVotesData = userVotesSnap.exists ? userVotesSnap.data() : {};
                const existingVotes = userVotesData.votes || {};

                if (existingVotes[clientId]) {
                    logger.info(`Duplicate vote detected: user=${userId}, clientId=${clientId}`);
                    isDuplicate = true;
                    return; // Exit transaction without writing
                }

                // Compute new aggregates for this clientId
                const allResults = allResultsSnap.exists ? allResultsSnap.data() : {};
                const current = allResults[clientId] || {
                    total_votes: 0,
                    total_score: 0,
                    average_score: 0,
                    skin_name: skinName,
                    character_name: characterName,
                };

                const newTotalVotes = current.total_votes + 1;
                const newTotalScore = current.total_score + rating;
                const newAverageScore = Math.round((newTotalScore / newTotalVotes) * 100) / 100;

                // Write phase: update all_poll_results (merge to avoid overwriting other skins)
                transaction.set(
                    allResultsRef,
                    {
                        [clientId]: {
                            total_votes: newTotalVotes,
                            total_score: newTotalScore,
                            average_score: newAverageScore,
                            skin_name: skinName,
                            character_name: characterName,
                        },
                    },
                    { merge: true }
                );

                // Write phase: record this vote in user_votes
                transaction.set(
                    userVotesRef,
                    {
                        votes: {
                            ...existingVotes,
                            [clientId]: {
                                rating,
                                skin_name: skinName,
                                character_name: characterName,
                                voted_at: new Date().toISOString(),
                            },
                        },
                    },
                    { merge: true }
                );
            });
        } catch (error) {
            logger.error(`Transaction failed for vote ${voteId}:`, error);
            // Don't delete the queue doc on transaction failure — it can be retried
            throw error;
        }

        // --- Step 3: Delete processed queue doc (outside transaction) ---
        try {
            await db.doc(`vote_queue/${voteId}`).delete();
            logger.info(`Queue doc deleted: ${voteId}${isDuplicate ? " (duplicate)" : ""}`);
        } catch (error) {
            logger.error(`Failed to delete queue doc ${voteId}:`, error);
            // Non-critical — the vote was already processed
        }

        if (isDuplicate) {
            return; // No need to update leaderboard for a duplicate
        }

        // --- Step 4: Update leaderboard (non-critical, outside transaction) ---
        await updateLeaderboard();

        logger.info(`Vote processed successfully: ${voteId} (${characterName}/${skinName} = ${rating})`);
    }
);
