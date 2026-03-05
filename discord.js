const WEBHOOK_URL = 'https://discord.com/api/webhooks/1448164705066811582/mMqemg7zZOW_VWuFuSs5Pb8qcZXKwUw9E5Ed4_it2H9OhT6Cq465fVBtLETosZ05bLF1';
const API_KEY = 'f4cfcbc1344eca4c261a9713853bc3e505608225475e0581c8';
const AFFILIATE_API_URL = 'https://api.diceblox.com/affiliates/';

// Cache for leaderboard data
let cachedData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes (to respect API rate limits)

async function fetchLeaderboard(retryCount = 0) {
    const now = Date.now();
    const maxRetries = 5;

    // Return cached data if still valid
    if (cachedData && (now - lastFetchTime) < CACHE_DURATION) {
        console.log('Using cached leaderboard data');
        return cachedData;
    }

    try {
        console.log('Fetching fresh data from API...');

        // Try a few different date approaches
        const attempts = [
            // Just use the start date from way back (gets all data since then)
            `${AFFILIATE_API_URL}2024-01-01T00:00:00+00:00`,
            // Try without any date parameter
            `${AFFILIATE_API_URL}`,
            // Try with just a slash
            `${AFFILIATE_API_URL}/`,
        ];

        let response = null;
        let successUrl = null;

        for (const url of attempts) {
            console.log('Trying API URL:', url);
            response = await fetch(url, {
                headers: {
                    'Authorization': API_KEY
                }
            });

            if (response.ok) {
                successUrl = url;
                console.log('✅ This URL format worked!');
                break;
            } else if (response.status === 429) {
                console.log('Rate limited, stopping attempts');
                break;
            } else {
                console.log(`Failed with status ${response.status}, trying next format...`);
            }
        }

        if (!response) {
            throw new Error('All URL formats failed');
        }

        if (response.status === 429) {
            console.warn('⚠️  Rate limited by API.');

            // If we have cached data, use it
            if (cachedData) {
                console.log('Using existing cached data');
                return cachedData;
            }

            // Otherwise, retry with exponential backoff
            if (retryCount < maxRetries) {
                const waitTime = Math.pow(2, retryCount) * 10000; // 10s, 20s, 40s, 80s, 160s
                console.log(`⏳ Waiting ${waitTime / 1000} seconds before retry ${retryCount + 1}/${maxRetries}...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                return fetchLeaderboard(retryCount + 1);
            }

            throw new Error('Rate limited and no cached data available after retries');
        }

        if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }

        const rawText = await response.text();
        console.log('Raw API Response:', rawText);

        const data = JSON.parse(rawText);
        console.log('Parsed API Response:', JSON.stringify(data, null, 2));
        console.log('Data keys:', Object.keys(data));
        console.log('Data type:', typeof data);

        if (data.affiliates) {
            console.log('Affiliates found:', Object.keys(data.affiliates).length);
        } else {
            console.log('No affiliates key found. Full data structure:', data);
        }

        // Cache the data
        cachedData = data;
        lastFetchTime = now;

        console.log('✅ Fetched fresh leaderboard data');
        return data;
    } catch (error) {
        console.error('❌ Error fetching leaderboard:', error.message);
        // If we have cached data, use it even if expired
        if (cachedData) {
            console.log('⚠️  Using expired cache due to API error');
            return cachedData;
        }
        throw error;
    }
}

function formatLeaderboardEmbed(data) {
    console.log('Formatting data:', JSON.stringify(data, null, 2));

    // Check if data has the expected structure
    if (!data || typeof data !== 'object') {
        console.error('Invalid data structure:', data);
        return {
            embeds: [{
                title: '🎲 DiceBlox Affiliate Leaderboard',
                description: '⚠️ No data available - API returned unexpected format',
                color: 0xFF0000,
                timestamp: new Date().toISOString()
            }]
        };
    }

    const affiliates = data.affiliates || data;

    // Sort affiliates by total wager (descending)
    const sortedAffiliates = Object.entries(affiliates)
        .map(([username, stats]) => ({
            username,
            ...stats
        }))
        .sort((a, b) => (b.totalWager || 0) - (a.totalWager || 0))
        .slice(0, 10); // Top 10

    console.log('Sorted affiliates:', sortedAffiliates);

    // Create leaderboard text
    let leaderboardText = '';
    sortedAffiliates.forEach((affiliate, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const wager = (affiliate.totalWager || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        const signups = affiliate.totalSignups || 0;

        leaderboardText += `${medal} **${affiliate.username}**\n`;
        leaderboardText += `   💰 Wager: ${wager} | 👥 Signups: ${signups}\n\n`;
    });

    if (leaderboardText === '') {
        leaderboardText = '⚠️ No affiliate data available for the selected time period.';
    }

    // Calculate total stats
    const totalWager = Object.values(affiliates)
        .reduce((sum, aff) => sum + (aff.totalWager || 0), 0);
    const totalSignups = Object.values(affiliates)
        .reduce((sum, aff) => sum + (aff.totalSignups || 0), 0);

    return {
        embeds: [{
            title: '🎲 DiceBlox Affiliate Leaderboard',
            description: leaderboardText,
            color: 0x5865F2, // Discord blurple
            fields: [
                {
                    name: '📊 Total Statistics',
                    value: `💰 Total Wager: ${totalWager.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n👥 Total Signups: ${totalSignups}`,
                    inline: false
                }
            ],
            footer: {
                text: 'Last 30 Days • Updates every 30 seconds (API cached 10 min)'
            },
            timestamp: new Date().toISOString()
        }]
    };
}

async function postLeaderboard() {
    try {
        console.log('Fetching leaderboard data...');
        const data = await fetchLeaderboard();

        console.log('Creating embed...');
        const embed = formatLeaderboardEmbed(data);

        console.log('Posting to Discord...');
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(embed)
        });

        if (!response.ok) {
            throw new Error(`Discord API returned ${response.status}: ${response.statusText}`);
        }

        console.log('✅ Leaderboard posted successfully!');
        return true;
    } catch (error) {
        console.error('❌ Error posting leaderboard:', error);
        return false;
    }
}

// Main execution
async function main() {
    console.log('🚀 DiceBlox Leaderboard Bot Starting...');

    // Post immediately on start
    await postLeaderboard();

    // Then post every 30 seconds
    setInterval(async () => {
        console.log('\n⏰ Running scheduled update...');
        await postLeaderboard();
    }, 30 * 1000); // 30 seconds

    console.log('✅ Bot is running. Leaderboard will update every 30 seconds.');
}

// Run the bot
main().catch(console.error);