#!/bin/bash

echo ""
echo " ============================================"
echo "  EVO Server Launcher - Web Interface"
echo " ============================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js non trovato nel PATH."
    echo "        Installalo con: sudo dnf install nodejs"
    exit 1
fi

# Check Wine
if ! command -v wine &> /dev/null; then
    echo "[ERROR] Wine non trovato nel PATH."
    echo "        Installalo con: sudo dnf install wine"
    exit 1
fi

# Go to script directory (works even if called from elsewhere)
cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "[INFO] Installazione dipendenze (npm install)..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[ERROR] npm install fallito!"
        exit 1
    fi
fi

echo "[INFO] Avvio EVO Server Launcher..."
echo "[INFO] Apri il browser su: http://localhost:$(node -e "try{const c=require('./config.json');console.log(c.webPort||3000)}catch(e){console.log(3000)}")"
echo "[INFO] Premi Ctrl+C per fermare."
echo ""

node src/server.js
