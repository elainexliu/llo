# Hardware bridge — Large Language Object

Web UI + Node server: **NFC tag personalities** (saved in **`data/nfc-personalities.json`**), **voice in** (Web Speech API), **Claude** filter (`/api/chat`), and optional **TTS**. Open the app via **`npm start`** so the API key stays in **`.env`**.

## Why HTML?

**Web Serial** (Chrome / Edge, `localhost` or HTTPS) connects to the **NFC Arduino** only. **Translate** posts to **`server.mjs`**, which calls Anthropic with **`ANTHROPIC_API_KEY`**.

**Voice input** uses the **Web Speech API**: each finalized phrase goes to **Received text**, then through Claude, then **Translation**. Only filtered text is sent to your server for the model.

**Audio output (TTS):** **OpenAI**, **ElevenLabs**, or **Browser** — see the in-app TTS controls and **`/api/tts-status`**.

## NFC (Arduino + PN532)

Flash **`firmware/nfc_uid_bridge/nfc_uid_bridge.ino`**. It prints **115200** baud lines like  
`{"nfc_uid":"04eb3649be2a81"}`  
(lowercase hex, no `0x`). In the browser, **Connect NFC** and tap tags; each UID loads a personality from **`data/nfc-personalities.json`**. Edit in the **NFC personalities** panel and **Save to server**. **Default filter** clears the tag and uses the built-in neutral filter.

## Run the web UI

```bash
cd hardware-bridge
npm install
npm start
```

Open **Chrome or Edge**: [http://localhost:8787](http://localhost:8787) (override with `PORT` in `.env`).

1. **Connect NFC** → PN532 board. Tags map to **`GET/PUT /api/nfc-personalities`**.
2. **Translation** uses the **active tag’s** prompt (or the **default** when none / after **Default filter**).
3. **Voice:** **Start listening** / **Stop listening**; **Translate** sends the whole **Received** box as one request. Each request is **stateless** (no prior turns sent to Claude). **Clear text** empties both text areas and stops mic/TTS for a fresh run.

Do **not** open `web/index.html` as `file://` — `/api/chat` will fail.

## LLM API

`web/js/filter-engine.js` posts to **`/api/chat`**. **`ANTHROPIC_API_KEY`**, optional **`ANTHROPIC_MODEL`** / **`ANTHROPIC_TEMPERATURE`** in **`.env`**.

**`/api/tts`**, **`/api/tts-elevenlabs`**, **`/api/nfc-personality-synthesize`**, **`/api/nfc-personalities`** — see `server.mjs`.

## Optional: 5-slider firmware (not used by this UI)

`firmware/pro_micro_sliders/` and **`firmware/xiao_sliders/`** remain for standalone experiments; the web app no longer connects to a slider MCU.
