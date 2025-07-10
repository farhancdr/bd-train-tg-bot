require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Constants
const SEAT_CLASSES = {
    S_CHAIR: 'S_CHAIR',
    SNIGDHA: 'SNIGDHA',
    AC_S: 'AC_S',
    F_BERTH: 'F_BERTH',
    F_SEAT: 'F_SEAT'
};

const MAX_ACTIVE_USERS = 10;
const POLL_INTERVAL = 5000; // 5 seconds
const adminChatId = '984869071';

// Global state
const userSessions = new Map(); // chatId => { chatId, mobile, password, token, tokenFetchedAt, active, interval, tripDetails }

// Initialize bot
const bot = new TelegramBot('8031359100:AAFwduTM-RVVv8IUsE9sZu5sUkmdWHDTtzs', { polling: true });

function buildUrl(fromCity, toCity, dateOfJourney) {
    return `https://railspaapi.shohoz.com/v1.0/web/bookings/search-trips-v2?from_city=${fromCity}&to_city=${toCity}&date_of_journey=${dateOfJourney}&seat_class=${SEAT_CLASSES.S_CHAIR}`;
}

async function signInAndGetToken(chatId, forceRefresh = false) {
    const session = userSessions.get(chatId);
    if (!session) throw new Error('User session not found.');

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    if (!forceRefresh && session.token && (Date.now() - session.tokenFetchedAt < ONE_DAY_MS)) {
        return session.token;
    }

    try {
        const response = await axios.post(
            'https://railspaapi.shohoz.com/v1.0/web/auth/sign-in',
            {
                mobile_number: session.mobile,
                password: session.password,
            },
            {
                headers: {
                    'sec-ch-ua-platform': '"macOS"',
                    'Referer': 'https://eticket.railway.gov.bd/',
                    'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Brave";v="138"',
                    'sec-ch-ua-mobile': '?0',
                    'X-Requested-With': 'XMLHttpRequest',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            }
        );

        session.token = response.data?.data?.token;
        session.tokenFetchedAt = Date.now();
        return session.token;
    } catch (error) {
        console.error(`Sign-in failed for chat ${chatId}:`, error.response?.data || error.message);
        return null;
    }
}

async function fetchSeatData(chatId, fromCity, toCity, dateOfJourney, trainNames, seatClass) {
    try {
        const token = await signInAndGetToken(chatId);
        if (!token) throw new Error('Authentication failed');

        const url = buildUrl(fromCity, toCity, dateOfJourney);
        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const trains = response.data.data.trains;
        const availableSeats = [];

        for (const train of trains) {
            const trainName = train.trip_number.split(' ')[0];
            if (trainNames.length === 0 || trainNames.includes(trainName)) {
                for (const seatType of train.seat_types) {
                    if (seatClass && seatType.type !== seatClass) continue;
                    const totalCount = seatType.seat_counts.online + seatType.seat_counts.offline;
                    console.log("🚀 ~ fetchSeatData ~ totalCount:", totalCount)
                    if (totalCount > 0) {
                        availableSeats.push({
                            trainName: train.trip_number,
                            seatClass: seatType.type,
                            availableSeats: totalCount
                        });
                    }
                }
            }
        }

        return availableSeats;
    } catch (error) {
        if (error.response?.status === 401) {
            console.warn(`Token expired for ${chatId}, retrying login...`);
            await signInAndGetToken(chatId, true);
            return await fetchSeatData(chatId, fromCity, toCity, dateOfJourney, trainNames, seatClass);
        }

        console.error(`Error fetching seat data for ${chatId}:`, error.response?.data || error.message);
        return [];
    }
}

function getActiveUserCount() {
    let count = 0;
    for (const session of userSessions.values()) {
        if (session.active) count++;
    }
    return count;
}

bot.onText(/\/start\s+(\d{10,11})\s+(.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const mobile = match[1];
    const password = match[2];

    userSessions.set(chatId, {
        chatId,
        mobile,
        password,
        token: null,
        tokenFetchedAt: null,
        active: false
    });

    bot.sendMessage(chatId,
      '✅ Registered' +
      'Welcome! Use /trip command to start searching for seats.\n' +
      'Format: /trip <from-city> <to-city> <journey-date> <train-names>\n' +
      'Example: /trip Dhaka Chittagong 2024-01-20 Suborno,Sonar'
  );
});

bot.onText(/\/trip (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);
    if (!session?.mobile || !session?.password) {
        bot.sendMessage(chatId, '❌ Please register first using /start <mobile_number> <password>.');
        return;
    }

    const params = match[1].split(' ');
    if (params.length < 3) {
        bot.sendMessage(chatId, '❌ Invalid format. Use: /trip <from> <to> <date> <trainNames>');
        return;
    }

    if (getActiveUserCount() >= MAX_ACTIVE_USERS && !session.active) {
        bot.sendMessage(chatId, '🚫 Max users reached (10). Try again later.');
        return;
    }

    const [fromCity, toCity, dateOfJourney, trainNamesStr] = params;
    const trainNames = trainNamesStr ? trainNamesStr.split(',') : [];
    const seatClass = params[4] || '';

    if (session.interval) clearInterval(session.interval);

    session.tripDetails = { fromCity, toCity, dateOfJourney, trainNames, seatClass };
    session.active = true;

    session.interval = setInterval(async () => {
        const seats = await fetchSeatData(chatId, fromCity, toCity, dateOfJourney, trainNames, seatClass);
        if (seats.length > 0) {
            const messageLines = seats.map(seat =>
                `🚂 Train: ${seat.trainName}\n💺 Class: ${seat.seatClass}\n📍 Available: ${seat.availableSeats}`
            );
            bot.sendMessage(chatId, `🎉 Available Seats Found!\n\n${messageLines.join('\n\n')}`);
        }
    }, POLL_INTERVAL);

    bot.sendMessage(chatId, '🔍 Seat search started. You will be notified.');
});

bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);
    if (!session?.active || !session.tripDetails) {
        bot.sendMessage(chatId, 'ℹ️ No active search. Use /trip to begin.');
        return;
    }
    const d = session.tripDetails;
    let message = `🔍 Search: From: ${d.fromCity} → ${d.toCity}\n📅 Date: ${d.dateOfJourney}`;
    if (d.trainNames.length) message += `\n🚆 Trains: ${d.trainNames.join(', ')}`;
    bot.sendMessage(chatId, message);
});

bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);
    if (session?.interval) {
        clearInterval(session.interval);
        session.active = false;
        session.tripDetails = null;
        bot.sendMessage(chatId, '🛑 Seat search stopped.');
    } else {
        bot.sendMessage(chatId, '❌ No active search.');
    }
});

bot.onText(/\/all-status/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== adminChatId) {
        bot.sendMessage(chatId, '🚫 Not authorized.');
        return;
    }
    const activeSearches = Array.from(userSessions.values()).filter(s => s.active && s.tripDetails);
    if (!activeSearches.length) return bot.sendMessage(chatId, 'ℹ️ No active searches.');

    const messageLines = ['🔎 Active Searches:'];
    for (const session of activeSearches) {
        const d = session.tripDetails;
        let line = `👤 ${session.chatId}\nFrom: ${d.fromCity} → ${d.toCity}\n📅 ${d.dateOfJourney}`;
        if (d.trainNames.length) line += `\n🚆 ${d.trainNames.join(', ')}`;
        messageLines.push(line);
    }
    bot.sendMessage(chatId, messageLines.join('\n\n'));
});

bot.on('error', (error) => {
    console.error('Telegram bot error:', error);
});

console.log('🚀 Bot is running...');