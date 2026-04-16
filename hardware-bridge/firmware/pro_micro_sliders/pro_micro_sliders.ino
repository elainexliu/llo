/**
 * Arduino Pro Micro (ATmega32U4) — 5 analog sliders as JSON lines over USB Serial.
 * Compatible with SparkFun Pro Micro and common clones (e.g. Tenstar Robot).
 *
 * ADC is 10-bit: 0–1023 (matches hardware-bridge/web/js/app.js ADC_MAX = 1023).
 *
 * Pins: A0–A3 and A6 (five analog inputs on typical Pro Micro breakouts).
 * If your board labels differ, change SLIDER_PINS only — keep KNOB_KEYS order.
 */

#if !defined(__AVR_ATmega32U4__)
#error "Select board: SparkFun Pro Micro or compatible (ATmega32U4)."
#endif

static const uint8_t SLIDER_COUNT = 3;  //5
static const uint8_t SLIDER_PINS[SLIDER_COUNT] = { A0, A1, A2, }; //A3, A6 

static const char *KNOB_KEYS[SLIDER_COUNT] = {
  "register",
  "trust",
  "subtext",
}; //  "formality", "projection",

const unsigned long SEND_INTERVAL_MS = 50;
unsigned long lastSend = 0;

void setup() {
  Serial.begin(9600);
  analogReference(DEFAULT);
}

void loop() {
  unsigned long now = millis();
  if (now - lastSend < SEND_INTERVAL_MS) {
    return;
  }
  lastSend = now;

  Serial.print('{');
  for (uint8_t i = 0; i < SLIDER_COUNT; i++) {
    int raw = analogRead(SLIDER_PINS[i]);
    if (i) Serial.print(',');
    Serial.print('"');
    Serial.print(KNOB_KEYS[i]);
    Serial.print("\":");
    Serial.print(raw);
  }
  Serial.println('}');
}

