/**
 * Seeed XIAO ESP32 — stream 5 analog slider values as JSON lines over USB Serial.
 * Matches web knob ids: register, trust, subtext, formality, projection
 *
 * Board: default pins D0–D4 (Seeed XIAO ESP32S3). Change SLIDER_PINS if your wiring differs.
 */

#if !defined(ARDUINO_ARCH_ESP32)
#error "This sketch targets ESP32 (e.g. Seeed XIAO ESP32S3)."
#endif

// Analog inputs — Seeed XIAO ESP32S3: D0–D10 include ADC-capable pins; D0–D4 used here.
static const int SLIDER_PINS[5] = { D0, D1, D2, D3, D4 };

static const char *KNOB_KEYS[5] = {
  "register",
  "trust",
  "subtext",
  "formality",
  "projection"
};

const unsigned long SEND_INTERVAL_MS = 50; // ~20 Hz
unsigned long lastSend = 0;

void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 5; i++) {
    pinMode(SLIDER_PINS[i], INPUT);
  }
}

void loop() {
  unsigned long now = millis();
  if (now - lastSend < SEND_INTERVAL_MS) {
    return;
  }
  lastSend = now;

  Serial.print('{');
  for (int i = 0; i < 5; i++) {
    int raw = analogRead(SLIDER_PINS[i]);
    if (i) Serial.print(',');
    Serial.print('"');
    Serial.print(KNOB_KEYS[i]);
    Serial.print("\":");
    Serial.print(raw);
  }
  Serial.println('}');
}
