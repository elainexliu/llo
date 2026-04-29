# Hardware bridge — Large Language Object (single player)

Firmware + web UI: **5 physical sliders** over **USB serial** (Web Serial in the browser). Default setup targets **Arduino Pro Micro** (ATmega32U4), including **Tenstar Robot** and similar clones.

An **ESP32 XIAO** sketch is still in `firmware/xiao_sliders/` if you switch boards — set `ADC_MAX` in `web/js/app.js` to **4095** for 12-bit ESP32.

## Why HTML?

The UI is **HTML + JavaScript**. **Web Serial** talks to the MCU over USB without a separate desktop bridge. **Translate** sends prompts to a tiny **Node server** (`server.mjs`) so your **Anthropic API key stays in `.env`**, not in the browser.

**Voice input** uses the browser **Web Speech API** (Chrome / Edge): **Start listening** / **Stop listening** capture the **default system microphone**, append each recognized phrase to **Received text**, and **append each filtered line** to **Translation** as you speak. Speech recognition runs in the browser (often via Google’s service); only the **filtered text** is sent to Anthropic through your server.

**Audio output (TTS):** choose **Engine** in the UI — **OpenAI** (`POST /api/tts`, needs **`OPENAI_API_KEY`**), **ElevenLabs** (`POST /api/tts-elevenlabs`, needs **`ELEVENLABS_API_KEY`**), or **Browser** (free OS speech). For ElevenLabs, paste a **Voice ID** from the ElevenLabs app (**Voices**), or set **`ELEVENLABS_VOICE_ID`** in `.env` as the default when the field is empty. Pick **ElevenLabs model** (e.g. `eleven_multilingual_v2`, `eleven_v3`). Enable **Speak new lines** / **Speak last line**; **Stop speech** cancels playback. The line under the TTS controls reads **`/api/tts-status`** (which keys exist on the server) and briefly warns if the API call failed and **browser fallback** played instead.

## Tenstar Robot / boards with both 5V and 3.3V pins

Many Pro Micro clones print **5V**, **3.3V**, **VCC**, **RAW**, and **GND**.

- **Pro Micro 5V / 16 MHz (most common):** MCU I/O and default `analogReference(DEFAULT)` use **VCC ≈ 5 V** from USB. For each potentiometer, tie one end of the divider to **the same positive rail the MCU runs from** (usually the pin labeled **VCC** or **5V** — not RAW), the other end to **GND**, and the **wiper** to an analog pin (**A0–A3, A6** per the sketch). That gives the full **0–1023** range.
- **3.3V pin:** Often a **regulated 3.3 V output** for sensors. If you wire pots between **3.3V and GND** on a **5 V** Pro Micro, `analogRead` still works, but the ADC only sees ~0–3.3 V while the reference is ~5 V — you **lose the top ~34%** of the numeric range unless you change reference (advanced). Prefer **VCC/5V to GND** for sliders on a 5 V board.
- **3.3 V / 8 MHz Pro Micro:** If your board is the **3.3 V** variant, use **3.3V and GND** for the pot ends so the wiper stays within 0–3.3 V.

When in doubt: match pot **high side** to the rail that matches **VCC** on the silkscreen for your specific listing.

## Wiring (5 sliders)

Voltage divider per pot: **rail — wiper — GND** to the analog pins in `pro_micro_sliders.ino` (default **A0, A1, A2, A3, A6**).

## Flash firmware (Pro Micro)

1. Install **Arduino IDE** and the board support for **SparkFun AVR Boards** *or* use **Arduino Leonardo**-compatible core if your clone enumerates as Leonardo.
2. Select **SparkFun Pro Micro** (correct voltage / clock) or the matching clone profile.
3. Open `firmware/pro_micro_sliders/pro_micro_sliders.ino`, confirm pins, upload.

Serial: one JSON object per line at **115200 baud**, e.g.  
`{"register":512,"trust":200,"subtext":300,"formality":400,"projection":100}`  
(raw **10-bit**, 0–**1023**).

## Run the web UI (Anthropic chat + serial)

Web Serial only works on **https** or **`http://localhost`**. The app **must** be opened through the Node server so `/api/chat` can reach Anthropic with your key from `.env`.

```bash
cd hardware-bridge
npm install
npm start
```

Open **Chrome or Edge**: [http://localhost:8787](http://localhost:8787) (override with `PORT` in `.env`).

1. **Connect serial** → choose the Pro Micro’s USB COM port (optional: you can use **web sliders only** without hardware).
2. Adjust **web sliders** and/or physical pots — both drive the same **0–100** values; when serial is streaming, incoming readings update the on-screen sliders (about 20×/s).
3. **Voice:** **Start listening** / **Stop listening** use the **default mic** (Web Speech API). Each finalized phrase is appended to **Received text**, filtered, and the result **appended** to **Translation** (requests run in order). **Translate** (button) sends the **whole** Received box as one Claude call and appends one filtered block (`ANTHROPIC_MODEL`, default `claude-3-5-haiku-latest`). **Reset memory** clears both boxes and filter history.

Do **not** open `web/index.html` as a `file://` URL — the fetch to `/api/chat` will fail.

## LLM API

`web/js/filter-engine.js` posts to **`/api/chat`**. `server.mjs` reads **`ANTHROPIC_API_KEY`** plus optional **`ANTHROPIC_MODEL`** / **`ANTHROPIC_TEMPERATURE`** from **`.env`** via `dotenv`.  
**`/api/tts`** uses **`OPENAI_API_KEY`** (optional **`OPENAI_TTS_MODEL`** / **`OPENAI_TTS_VOICE`**). **`/api/tts-elevenlabs`** uses **`ELEVENLABS_API_KEY`** and optional **`ELEVENLABS_VOICE_ID`** / **`ELEVENLABS_MODEL_ID`**.
