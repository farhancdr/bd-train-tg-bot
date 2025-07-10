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

// Global state
const userSessions = new Map();
const adminChatId = '984869071';

// Initialize bot
const bot = new TelegramBot('8031359100:AAFwduTM-RVVv8IUsE9sZu5sUkmdWHDTtzs', { polling: true });

function buildUrl(fromCity, toCity, dateOfJourney) {
    return `https://railspaapi.shohoz.com/v1.0/web/bookings/search-trips-v2?from_city=${fromCity}&to_city=${toCity}&date_of_journey=${dateOfJourney}&seat_class=${SEAT_CLASSES.S_CHAIR}`;
}

async function fetchSeatData(fromCity, toCity, dateOfJourney, trainNames, seatClass) {
    try {
        const url = buildUrl(fromCity, toCity, dateOfJourney);
        const response = await axios.get(url);
        const trains = response.data.data.trains;
        
        const availableSeats = [];
        for (const train of trains) {
            const trainName = train.trip_number.split(' ')[0];
            if (trainNames.length === 0 || trainNames.includes(trainName)) {
                for (const seatType of train.seat_types) {
                    if (seatClass && seatType.type !== seatClass) continue;
                    
                    const totalCount = seatType.seat_counts.online + seatType.seat_counts.offline;
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
        console.error('Error fetching seat data:', error);
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

// Command handlers
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    userSessions.set(chatId, { chatId, active: false });
    
    bot.sendMessage(chatId,
        'Welcome! Use /trip command to start searching for seats.\n' +
        'Format: /trip <from-city> <to-city> <journey-date> <train-names>\n' +
        'Example: /trip Dhaka Chittagong 2024-01-20 Suborno,Sonar'
    );
});

bot.onText(/\/trip (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const params = match[1].split(' ');

    if (params.length < 3) {
        bot.sendMessage(chatId, 'Invalid format. Use: /trip <from-city> <to-city> <journey-date> <train-names>');
        return;
    }

    if (getActiveUserCount() >= MAX_ACTIVE_USERS) {
        const session = userSessions.get(chatId);
        if (!session?.active) {
            bot.sendMessage(chatId, 'Sorry, the system is currently at maximum capacity (10 users). Please try again later.');
            return;
        }
    }

    const [fromCity, toCity, dateOfJourney, trainNamesStr] = params;
    const trainNames = trainNamesStr ? trainNamesStr.split(',') : [];
    const seatClass = params[4] || '';

    // Stop existing search if any
    const existingSession = userSessions.get(chatId);
    if (existingSession?.interval) {
        clearInterval(existingSession.interval);
    }

    // Start new search
    const session = {
        chatId,
        active: true,
        tripDetails: {
            fromCity,
            toCity,
            dateOfJourney,
            trainNames,
            seatClass
        }
    };

    session.interval = setInterval(async () => {
        const seats = await fetchSeatData(fromCity, toCity, dateOfJourney, trainNames, seatClass);
        if (seats.length > 0) {
            const messageLines = seats.map(seat =>
                `🚂 Train: ${seat.trainName}\n💺 Class: ${seat.seatClass}\n📍 Available: ${seat.availableSeats}`
            );
            bot.sendMessage(chatId, `Found available seats!\n\n${messageLines.join('\n\n')}`);
        }
    }, POLL_INTERVAL);

    userSessions.set(chatId, session);
    bot.sendMessage(chatId, 'Started searching for seats. You will be notified when seats are available.');
});

bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);

    if (!session?.active || !session.tripDetails) {
        bot.sendMessage(chatId, 'No active search running. Use /trip to start searching.');
        return;
    }

    const details = session.tripDetails;
    let message = `Active search running:\nFrom: ${details.fromCity}\nTo: ${details.toCity}\nDate: ${details.dateOfJourney}`;
    if (details.trainNames.length > 0) {
        message += `\nTrains: ${details.trainNames.join(', ')}`;
    }

    bot.sendMessage(chatId, message);
});

bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;
    const session = userSessions.get(chatId);

    if (session?.interval) {
        clearInterval(session.interval);
        session.active = false;
        session.tripDetails = null;
        bot.sendMessage(chatId, 'Stopped searching for seats.');
    } else {
        bot.sendMessage(chatId, 'No active search to stop.');
    }
});

bot.onText(/\/all-status/, (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId.toString() !== adminChatId) {
        bot.sendMessage(chatId, 'You are not authorized to use this command.');
        return;
    }

    const activeSearches = Array.from(userSessions.values())
        .filter(session => session.active && session.tripDetails);

    if (activeSearches.length === 0) {
        bot.sendMessage(chatId, 'No active searches running.');
        return;
    }

    const messageLines = ['🔍 Current Active Searches:'];
    
    for (const session of activeSearches) {
        const details = session.tripDetails;
        let userStatus = `\n👤 User ID: ${session.chatId}\n` +
            `🚉 From: ${details.fromCity}\n` +
            `🏁 To: ${details.toCity}\n` +
            `📅 Date: ${details.dateOfJourney}`;

        if (details.trainNames.length > 0) {
            userStatus += `\n🚂 Trains: ${details.trainNames.join(', ')}`;
        }

        messageLines.push(userStatus);
    }

    bot.sendMessage(chatId, messageLines.join('\n\n'));
});

// Error handling
bot.on('error', (error) => {
    console.error('Telegram bot error:', error);
});

// Start the bot
console.log('Bot is running...');