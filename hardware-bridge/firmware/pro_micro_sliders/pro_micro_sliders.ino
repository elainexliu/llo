// /**
//  * Arduino Pro Micro (ATmega32U4) — 5 analog sliders as JSON lines over USB Serial.
//  * Compatible with SparkFun Pro Micro and common clones (e.g. Tenstar Robot).
//  *
//  * ADC is 10-bit: 0–1023 (matches hardware-bridge/web/js/app.js ADC_MAX = 1023).
//  *
//  * Pins: A0–A3 and A6 (five analog inputs on typical Pro Micro breakouts).
//  * If your board labels differ, change SLIDER_PINS only — keep KNOB_KEYS order.
//  */

// #if !defined(__AVR_ATmega32U4__)
// #error "Select board: SparkFun Pro Micro or compatible (ATmega32U4)."
// #endif

// static const uint8_t SLIDER_COUNT = 3;  //5
// static const uint8_t SLIDER_PINS[SLIDER_COUNT] = { A0, A1, A2, }; //A3, A6 

// static const char *KNOB_KEYS[SLIDER_COUNT] = {
//   "register",
//   "trust",
//   "subtext",
// }; //  "formality", "projection",

// const unsigned long SEND_INTERVAL_MS = 50;
// unsigned long lastSend = 0;

// void setup() {
//   Serial.begin(9600);
//   analogReference(DEFAULT);
// }

// void loop() {
//   unsigned long now = millis();
//   if (now - lastSend < SEND_INTERVAL_MS) {
//     return;
//   }
//   lastSend = now;

//   Serial.print('{');
//   for (uint8_t i = 0; i < SLIDER_COUNT; i++) {
//     int raw = analogRead(SLIDER_PINS[i]);
//     if (i) Serial.print(',');
//     Serial.print('"');
//     Serial.print(KNOB_KEYS[i]);
//     Serial.print("\":");
//     Serial.print(raw);
//   }
//   Serial.println('}');
// }



/**
 * Arduino Pro Micro (ATmega32U4)
 * 
 * One active slider + rotary encoder to navigate/select filter parameters.
 * No OLED — filter name and value printed over Serial for debugging.
 * 
 * Interaction:
 *   - Rotate encoder  → cycle through filter names (printed to Serial)
 *   - Click encoder   → enter edit mode for selected filter
 *   - Move slider     → adjust selected filter value
 *   - Click encoder   → confirm value, exit edit mode, send JSON
 *
 * Serial payload now includes UI metadata so the web app can render:
 *   "_mode": "browse" | "edit"
 *   "_selected": 0..4
 * 
 * Wiring:
 *   Slider wiper  → A0
 *   Encoder CLK   → pin 0 (INT2)
 *   Encoder DT    → pin 1 (INT3)
 *   Encoder SW    → pin 4
 */

 #if !defined(__AVR_ATmega32U4__)
 #error "Select board: SparkFun Pro Micro or compatible (ATmega32U4)."
 #endif
 
 // ─── PIN CONFIG ───────────────────────────────────────────────────────────────
 
static const uint8_t SLIDER_PIN = A0;
static const uint8_t ENC_CLK    = 0;
static const uint8_t ENC_DT     = 1;
static const uint8_t ENC_SW     = 4;

static const uint8_t FILTER_COUNT = 5;

static const char* FILTER_KEYS[FILTER_COUNT] = {
  "register", "trust", "subtext", "formality", "projection",
};
static const char* FILTER_LABELS[FILTER_COUNT] = {
  "Register", "Trust", "Subtext", "Formality", "Projection",
};

int filterValues[FILTER_COUNT] = { 50, 40, 35, 50, 20 };

enum Mode { BROWSE, EDIT };
Mode mode = BROWSE;

volatile int encDelta = 0;
static uint8_t lastEncState = 0;

static const int8_t ENC_TABLE[16] = {
   0, -1,  1,  0,
   1,  0,  0, -1,
  -1,  0,  0,  1,
   0,  1, -1,  0
};

void encoderISR() {
  uint8_t currA = digitalRead(ENC_CLK);
  uint8_t currB = digitalRead(ENC_DT);
  uint8_t currState = (currA << 1) | currB;
  int8_t step = ENC_TABLE[(lastEncState << 2) | currState];
  encDelta -= step;
  lastEncState = currState;
}

int selectedFilter = 0;
int editValue      = 50;
static int encAccum = 0;

unsigned long lastButtonTime     = 0;
const unsigned long DEBOUNCE_MS  = 200;
const unsigned long SEND_INTERVAL_MS = 50;
unsigned long lastSend = 0;

int rawToPercent(int raw) {
  return constrain(map(raw, 0, 1023, 0, 100), 0, 100);
}

void sendJSON() {
  Serial.print('{');
  for (uint8_t i = 0; i < FILTER_COUNT; i++) {
    if (i) Serial.print(',');
    Serial.print('"');
    Serial.print(FILTER_KEYS[i]);
    Serial.print("\":");
    if (mode == EDIT && i == selectedFilter) {
      Serial.print(map(editValue, 0, 100, 0, 1023));
    } else {
      Serial.print(map(filterValues[i], 0, 100, 0, 1023));
    }
  }
  Serial.print(",\"_mode\":\"");
  Serial.print(mode == BROWSE ? "browse" : "edit");
  Serial.print("\",\"_selected\":");
  Serial.print(selectedFilter);
  Serial.println('}');
}

void setup() {
  Serial.begin(115200);

  pinMode(ENC_CLK, INPUT_PULLUP);
  pinMode(ENC_DT,  INPUT_PULLUP);
  pinMode(ENC_SW,  INPUT_PULLUP);

  lastEncState = (digitalRead(ENC_CLK) << 1) | digitalRead(ENC_DT);

  attachInterrupt(digitalPinToInterrupt(ENC_CLK), encoderISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_DT),  encoderISR, CHANGE);

  analogReference(DEFAULT);
}

void loop() {
  unsigned long now = millis();

  // Read encoder delta atomically
  int rawDelta = 0;
  noInterrupts();
  rawDelta = encDelta;
  encDelta = 0;
  interrupts();

  // Accumulate and threshold by pulses-per-detent
  encAccum += rawDelta;
  const int PULSES_PER_DETENT = 4; // try 4 if still jumping
  int delta = encAccum / PULSES_PER_DETENT;
  encAccum %= PULSES_PER_DETENT;

  // Button debounce
  bool clicked = false;
  if (digitalRead(ENC_SW) == LOW && (now - lastButtonTime > DEBOUNCE_MS)) {
    clicked = true;
    lastButtonTime = now;
  }

  // Slider
  int sliderPct = rawToPercent(analogRead(SLIDER_PIN));

  // State machine
  if (mode == BROWSE) {
    if (delta != 0) {
      selectedFilter = constrain(selectedFilter + delta, 0, FILTER_COUNT - 1);
    }
    if (clicked) {
      editValue = filterValues[selectedFilter];
      mode = EDIT;
      sendJSON();
    }
    if (now - lastSend >= SEND_INTERVAL_MS) {
      lastSend = now;
      sendJSON();
    }
  }
  else { // EDIT
    if (abs(sliderPct - editValue) > 1) {
      editValue = sliderPct;
      sendJSON();
    }
    if (clicked) {
      filterValues[selectedFilter] = editValue;
      mode = BROWSE;
      sendJSON();
    }
  }
}
