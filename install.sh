#!/data/data/com.termux/files/usr/bin/bash

# Set Variables
REPO_URL="https://github.com/farhancdr/bd-train-tg-bot.git"
INSTALL_DIR="$HOME/node-server"
PROJECT_DIR="$INSTALL_DIR/bd-train-tg-bot"

# echo "📦 Updating Termux and installing dependencies..."
# export DEBIAN_FRONTEND=noninteractive
# pkg update -y && yes N | pkg upgrade -y
# pkg install -y nodejs git termux-api

echo "🔒 Enabling wake-lock to keep process alive..."
termux-wake-lock

# Clone or update the repository
if [ -d "$PROJECT_DIR" ]; then
    echo "🔁 Project already exists. Pulling latest changes..."
    cd "$PROJECT_DIR"
    git pull
else
    echo "📥 Cloning repository..."
    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    git clone "$REPO_URL"
    cd "$PROJECT_DIR"
fi

# Install dependencies
echo "📦 Installing project dependencies..."
npm install

# Install PM2 globally
echo "🚀 Installing PM2 globally..."
npm install -g pm2


# Start with PM2
echo "🚀 Starting server with PM2..."
pm2 start index.js --name train-bot
pm2 save
pm2 startup

echo -e \"\n✅ Setup complete! Your Telegram bot is now running.\\n\"
echo \"📂 Logs: pm2 logs train-bot\"
echo \"🛑 Stop: pm2 stop train-bot\"
echo \"▶️ Restart: pm2 restart train-bot\"
echo \"📌 PM2 will auto-start the bot on reboot.\"
