#!/data/data/com.termux/files/usr/bin/bash

# Set Variables
REPO_URL="https://github.com/farhancdr/tg-train-ticket-bot"  # Change this to your GitHub repo
INSTALL_DIR="$HOME/node-server"
PROJECT_DIR="$INSTALL_DIR/node-clone"

echo "Updating Termux and installing dependencies..."
pkg update -y && pkg upgrade -y
pkg install -y nodejs git termux-api

# Enable wake lock to prevent Android from killing the process
termux-wake-lock

# Clone or update the repository
if [ -d "$INSTALL_DIR" ]; then
    echo "Project already exists. Pulling latest changes...."
    cd "$INSTALL_DIR"
    git pull
    cd "$PROJECT_DIR"
else
    echo "Cloning repository..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$PROJECT_DIR"
fi


# Install Node.js dependencies
echo "Installing project dependencies..."
npm install

# Install PM2 globally
echo "Installing PM2..."
npm install -g pm2

# Start the Node.js server with PM2
echo "Starting the server with PM2..."
pm2 start index.js --name node-server
pm2 save
pm2 startup

echo "Setup complete! Your server is running in the background 24/7."
