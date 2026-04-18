# ACEVO Server Launcher — Web Interface

Browser-based launcher per il **Assetto Corsa EVO Dedicated Server**.  
Funziona sia su **Windows** che su **Linux** (AlmaLinux, Ubuntu, ecc.) tramite Wine.

---

## Requisiti

### Windows
- [Node.js](https://nodejs.org) v18 o superiore

### Linux
- [Node.js](https://nodejs.org) v18 o superiore (`sudo dnf install nodejs` su AlmaLinux/RHEL)
- [Wine](https://www.winehq.org) (`sudo dnf install wine`)
- Il Dedicated Server di Assetto Corsa EVO (vedi sezione Linux qui sotto)

---

## Installazione su Windows

1. **Installa il Dedicated Server** da Steam:
   - Apri Steam → Libreria → cerca *Assetto Corsa EVO Dedicated Server*
   - Installalo nella cartella che preferisci

2. **Estrai** lo zip del launcher in una cartella a piacere

3. **Modifica `config.json`** con i tuoi valori (vedi sezione Config)

4. **Doppio click su `start.bat`** — al primo avvio installa le dipendenze automaticamente

5. **Apri il browser** su `http://localhost:<webPort>` e accedi con la password configurata

---

## Installazione su Linux

### 1. Scarica il Dedicated Server da Steam

Il server è un eseguibile Windows, quindi va scaricato su **Windows** e poi copiato su Linux,
oppure scaricato direttamente su Linux tramite **SteamCMD**:

```bash
# Installa SteamCMD (AlmaLinux/RHEL)
sudo dnf install steamcmd

# Scarica il Dedicated Server (App ID: 4564210)
steamcmd +force_install_dir ~/ace-server \
         +login anonymous \
         +app_update 4564210 validate \
         +quit
```

> **Nota:** se il server richiede un account Steam autenticato, accedi con il tuo account
> invece di `anonymous`.

In alternativa, puoi installarlo su Windows e copiare l'intera cartella su Linux via `scp` o una chiavetta USB.

### 2. Installa Wine e Node.js

```bash
# AlmaLinux / RHEL / CentOS
sudo dnf install wine nodejs

# Ubuntu / Debian
sudo apt install wine nodejs npm
```

### 3. Installa il launcher

```bash
unzip evo-server-launcher.zip -d ~/evo-launcher
cd ~/evo-launcher/evo-server-launcher
chmod +x start.sh
```

### 4. Configura `config.json`

Su Linux il path dell'eseguibile va in formato Unix:

```json
{
  "executablePath": "/home/utente/ace-server/AssettoCorsaEVOServer.exe"
}
```

### 5. Avvia

```bash
./start.sh
```

Apri il browser su `http://localhost:<webPort>`.

### Avvio automatico con systemd (opzionale)

Per far partire il launcher automaticamente al boot del server:

```bash
sudo nano /etc/systemd/system/acevo-launcher.service
```

```ini
[Unit]
Description=ACEVO Server Launcher
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/evo-launcher/evo-server-launcher
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable acevo-launcher
sudo systemctl start acevo-launcher
```

---

## config.json

Il file `config.json` si trova nella root del launcher, accanto a `start.bat` / `start.sh`.

```json
{
  "webPort": 3000,
  "adminPassword": "la_tua_password",
  "language": "it",
  "executablePath": "C:\\ACE\\AssettoCorsaEVOServer.exe",
  "serverCount": 2,
  "serverSuffix": "by YAK"
}
```

| Campo | Descrizione |
|---|---|
| `webPort` | Porta dell'interfaccia web |
| `adminPassword` | Password di accesso al pannello |
| `language` | Lingua default (`en`, `it`, `de`, `fr`) |
| `executablePath` | Percorso completo dell'eseguibile del server |
| `serverCount` | Numero di server da gestire (1 o più) |
| `serverSuffix` | Testo aggiunto dopo il nome del server (es. `"by YAK"`). Se vuoto, il nome rimane invariato. |

> Dopo aver modificato `config.json` riavvia il launcher per applicare le modifiche.

### Note sul serverSuffix

Il nome finale del server pubblicato sarà:
- Con suffisso: `<nome impostato nel pannello> - <serverSuffix>`
- Senza suffisso (campo vuoto o assente): `<nome impostato nel pannello>`

---

## File di gioco richiesti

Nella stessa cartella dell'eseguibile devono essere presenti:

| File | Contenuto |
|---|---|
| `cars.json` | Lista delle macchine disponibili |
| `events_practice.json` | Circuiti per la modalità Prove Libere |
| `events_race_weekend.json` | Circuiti per il Race Weekend |

Questi file vengono distribuiti insieme al Dedicated Server da Steam.

---

## Dati salvati

| File | Contenuto |
|---|---|
| `~/ACE/server_1.json` | Configurazione del Server 1 |
| `~/ACE/server_2.json` | Configurazione del Server 2 |
| `~/ACE/server_N.json` | ... |
| `config.json` | Configurazione del launcher (accanto a `start.bat`) |

Su Windows `~` corrisponde a `C:\Users\<utente>`.

---

## Lingue supportate

🇬🇧 English · 🇮🇹 Italiano · 🇩🇪 Deutsch · 🇫🇷 Français

La lingua può essere cambiata dalla UI senza riavviare il launcher.
