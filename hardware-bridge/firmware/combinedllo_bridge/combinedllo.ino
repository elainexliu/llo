
#include <SPI.h>
#include <Wire.h>
#include <Adafruit_PN532.h>
#include <driver/i2s.h>
#include "epd2in13_V4.h"
#include "epdpaint.h"
#include "imagedata.h"

#define COLORED   0
#define UNCOLORED 1

// ─── Pins ─────────────────────────────────────────────────────────────────────
#define I2S_WS      48
#define I2S_SD      35
#define I2S_SCK     45
#define I2S_PORT    I2S_NUM_0
#define LISTEN_BTN  2
#define CART_BTN    21
#define CONFIRM_BTN 20
#define LED_PIN     4
#define SDA_PIN     18
#define SCL_PIN     46

// ─── State machine ────────────────────────────────────────────────────────────
enum State {
  IDLE,
  TAG_KNOWN,
  TAG_NEW,
  RECORDING_CARTRIDGE,
  GENERATING,
  FILTER_SAVED,
  ACTIVE_FILTER
};

State currentState = IDLE;

// ─── NFC ──────────────────────────────────────────────────────────────────────
Adafruit_PN532 nfc(-1, -1);
String currentUid = "";
unsigned long lastNfcCheckAt = 0;
const unsigned long NFC_CHECK_INTERVAL = 500;
const unsigned long NFC_REMOVAL_TIMEOUT = 8000;
unsigned long lastNfcSeenAt = 0;
bool tagPresent = false;

// ─── Filter data ──────────────────────────────────────────────────────────────
char filterName[64] = "";
char filterDesc[128] = "";

// ─── Button debounce ──────────────────────────────────────────────────────────
struct Button {
  int pin;
  bool lastRaw;
  bool stable;
  unsigned long lastChangeAt;
};

Button listenBtn  = { LISTEN_BTN,  HIGH, HIGH, 0 };
Button cartBtn    = { CART_BTN,    HIGH, HIGH, 0 };
Button confirmBtn = { CONFIRM_BTN, HIGH, HIGH, 0 };

const unsigned long DEBOUNCE_MS = 80;

// ─── Mic / listening ──────────────────────────────────────────────────────────
bool isListening = false;
bool isCartRecording = false;

// ─── E-ink ────────────────────────────────────────────────────────────────────
unsigned char image[4000];
Epd epd;

// ─────────────────────────────────────────────────────────────────────────────
// E-INK HELPERS
// ─────────────────────────────────────────────────────────────────────────────
int strPixelWidth(const char* str, sFONT* font) {
  if (!str) return 0;
  return strlen(str) * font->Width;
}

int centerX(const char* str, sFONT* font) {
  return (250 - strPixelWidth(str, font)) / 2;
}

void einkShow(const char* topLabel, const char* mainText, const char* blurb, bool showLine, const char* actionMid, const char* actionLeft, const char* actionRight) {
  Paint paint(image, 128, 250);
  paint.SetRotate(ROTATE_270);
  paint.Clear(UNCOLORED);

  if (topLabel) paint.DrawStringAt(8, 8,  topLabel, &Font16, COLORED);
  if (mainText) paint.DrawStringAt(8, 25, mainText, &Font24, COLORED);
  if (blurb)    paint.DrawStringAt(8, 55, blurb,    &Font12, COLORED);

  if (showLine) paint.DrawLine(8, 85, 242, 85, COLORED);

  if (actionMid) {
    paint.DrawStringAt(centerX(actionMid, &Font12), 100, actionMid, &Font12, COLORED);
  } else {
    if (actionLeft)  paint.DrawStringAt(8, 100, actionLeft, &Font12, COLORED);
    if (actionRight) paint.DrawStringAt(250 - strPixelWidth(actionRight, &Font12) - 8, 100, actionRight, &Font12, COLORED);
  }

  epd.Display(image);
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN STATES
// ─────────────────────────────────────────────────────────────────────────────
void screenIdle() {
  einkShow("welcome to", "en clair.", "nothing is ever in plain language", true, "INSERT FILTER TO BEGIN", NULL, NULL);
}

void screenCartridgeRemoved() {
  einkShow(NULL, "filter removed.", NULL, true, "INSERT FILTER TO BEGIN", NULL, NULL);
}

void screenKnownTag() {
  einkShow("filter:", filterName, filterDesc, true, NULL, "CONFIRM to use", "RECORD to edit");
}

void screenNewTag() {
  einkShow("new filter", NULL, NULL, true, NULL, NULL, "RECORD to define");
}

void screenRecording() {
  einkShow("describe how you want", "to hear the world...", NULL, true, NULL, NULL, "RECORD to stop");
}

void screenGenerating() {
  einkShow("generating your", "filter...", NULL, false, NULL, NULL, NULL);
}

void screenFilterSaved() {
  einkShow("filter saved:", filterName, "is ready to be used.", true, "CLOSE LID + START TRANSLATION", NULL, NULL);
}

void screenActiveFilter() {
  einkShow("ACTIVE FILTER:", filterName, NULL, false, NULL, NULL, NULL);
}

// ─────────────────────────────────────────────────────────────────────────────
// BUTTON POLLING
// ─────────────────────────────────────────────────────────────────────────────
bool buttonPressed(Button& btn) {
  bool raw = digitalRead(btn.pin);
  if (raw != btn.lastRaw) {
    btn.lastChangeAt = millis();
    btn.lastRaw = raw;
  }
  if ((millis() - btn.lastChangeAt) >= DEBOUNCE_MS && btn.stable != raw) {
    btn.stable = raw;
    return btn.stable == LOW;
  }
  return false;
}

bool buttonReleased(Button& btn) {
  bool raw = digitalRead(btn.pin);
  if (raw != btn.lastRaw) {
    btn.lastChangeAt = millis();
    btn.lastRaw = raw;
  }
  if ((millis() - btn.lastChangeAt) >= DEBOUNCE_MS && btn.stable != raw) {
    btn.stable = raw;
    return btn.stable == HIGH;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// NFC POLLING
// ─────────────────────────────────────────────────────────────────────────────
// void checkNfc() {
//   if (isListening) return;
//   if (currentState == ACTIVE_FILTER) return;
//   if (currentState == RECORDING_CARTRIDGE) return;
//   // if (currentState == TAG_KNOWN) return;
//   // if (currentState == TAG_NEW) return;
//   // if (currentState == FILTER_SAVED) return;
//   // if (currentState == ACTIVE_FILTER) return;

//   unsigned long now = millis();
//   if (now - lastNfcCheckAt < NFC_CHECK_INTERVAL) return;
//   lastNfcCheckAt = now;

//   uint8_t uid[7];
//   uint8_t uidLen;
//   uint16_t timeout = (tagPresent) ? 50 : 500;
//   bool detected = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLen, timeout);

//   if (detected) {
//     String hex = "";
//     for (uint8_t i = 0; i < uidLen; i++) {
//       if (uid[i] < 16) hex += '0';
//       hex += String(uid[i], HEX);
//     }
//     hex.toLowerCase();
//     lastNfcSeenAt = now;

//     if (!tagPresent || hex != currentUid) {
//       tagPresent = true;
//       currentUid = hex;
//       Serial.print("{\"nfc_uid\":\"");
//       Serial.print(hex);
//       Serial.println("\"}");
//     }
//   } else {
//     if (tagPresent && (now - lastNfcSeenAt) > NFC_REMOVAL_TIMEOUT) {
//       tagPresent = false;
//       currentUid = "";
//       filterName[0] = '\0';
//       filterDesc[0] = '\0';

//       if (currentState != ACTIVE_FILTER || !isListening) {
//         currentState = IDLE;
//         screenCartridgeRemoved();
//         delay(2000);
//         screenIdle();
//       }
//     }
//   }
// }
// void checkNfc() {
//   if (isListening) return;
//   if (currentState == RECORDING_CARTRIDGE) return;

//   unsigned long now = millis();

//   // ── removal check (runs every loop, no blocking read needed) ─────────────
//   if (tagPresent && (now - lastNfcSeenAt) > NFC_REMOVAL_TIMEOUT) {
//     Serial.print("DEBUG removal: now=");
//     Serial.print(now);
//     Serial.print(" lastSeen=");
//     Serial.print(lastNfcSeenAt);
//     Serial.print(" diff=");
//     Serial.println(now - lastNfcSeenAt);

//     tagPresent = false;
//     currentUid = "";
//     filterName[0] = '\0';
//     filterDesc[0] = '\0';
//     currentState = IDLE;
//     screenCartridgeRemoved();
//     delay(2000);
//     screenIdle();
//     return;
//   }

//   // ── detection poll ────────────────────────────────────────────────────────
//   if (now - lastNfcCheckAt < NFC_CHECK_INTERVAL) return;
//   lastNfcCheckAt = now;

//   uint8_t uid[7];
//   uint8_t uidLen;
//   // short timeout in non-IDLE states so buttons stay responsive
//   // longer timeout in IDLE to reliably detect new tags
//   uint16_t timeout = 500;//(currentState == IDLE) ? 500 : 150;
//   bool detected = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLen, timeout);

//   Serial.print("DEBUG nfc poll: state=");
//   Serial.print(currentState);
//   Serial.print(" detected=");
//   Serial.print(detected);
//   Serial.print(" lastSeen=");
//   Serial.println(lastNfcSeenAt);

//   if (detected) {
//     String hex = "";
//     for (uint8_t i = 0; i < uidLen; i++) {
//       if (uid[i] < 16) hex += '0';
//       hex += String(uid[i], HEX);
//     }
//     hex.toLowerCase();
//     lastNfcSeenAt = now;  // keep tag alive regardless of state

//     if (!tagPresent || hex != currentUid) {
//       tagPresent = true;
//       currentUid = hex;
//       // only notify laptop when in IDLE — not mid-session
//       if (currentState == IDLE) {
//         Serial.print("{\"nfc_uid\":\"");
//         Serial.print(hex);
//         Serial.println("\"}");
//       }
//     }
//   }
// }

void checkNfc() {
  if (isListening) return;
  if (currentState == RECORDING_CARTRIDGE) return;

  unsigned long now = millis();

  // if tag is present and we're past IDLE, keep it alive — don't rely on re-detection
  if (tagPresent && currentState != IDLE) {
    lastNfcSeenAt = now;  // keep resetting so removal never fires while tag is "in use"
    return;
  }

  // removal check — only relevant in IDLE
  if (tagPresent && (now - lastNfcSeenAt) > NFC_REMOVAL_TIMEOUT) {
    tagPresent = false;
    currentUid = "";
    filterName[0] = '\0';
    filterDesc[0] = '\0';
    currentState = IDLE;
    screenCartridgeRemoved();
    delay(2000);
    screenIdle();
    return;
  }

  // detection poll — only in IDLE
  if (now - lastNfcCheckAt < NFC_CHECK_INTERVAL) return;
  lastNfcCheckAt = now;

  uint8_t uid[7];
  uint8_t uidLen;
  bool detected = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLen, 500);

  if (detected) {
    String hex = "";
    for (uint8_t i = 0; i < uidLen; i++) {
      if (uid[i] < 16) hex += '0';
      hex += String(uid[i], HEX);
    }
    hex.toLowerCase();
    lastNfcSeenAt = now;

    if (!tagPresent || hex != currentUid) {
      tagPresent = true;
      currentUid = hex;
      Serial.print("{\"nfc_uid\":\"");
      Serial.print(hex);
      Serial.println("\"}");
    }
  } else {
    if (tagPresent && (now - lastNfcSeenAt) > NFC_REMOVAL_TIMEOUT) {
      tagPresent = false;
      currentUid = "";
      filterName[0] = '\0';
      filterDesc[0] = '\0';
      currentState = IDLE;
      screenCartridgeRemoved();
      delay(2000);
      screenIdle();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SERIAL INPUT — laptop responses
// ─────────────────────────────────────────────────────────────────────────────
String serialBuf = "";

void handleLaptopMessage(String& msg) {
  if (msg.indexOf("\"known\":true") >= 0) {
    int ni = msg.indexOf("\"name\":\"");
    if (ni >= 0) {
      ni += 8;
      int ne = msg.indexOf("\"", ni);
      msg.substring(ni, ne).toCharArray(filterName, sizeof(filterName));
    }
    int di = msg.indexOf("\"desc\":\"");
    if (di >= 0) {
      di += 8;
      int de = msg.indexOf("\"", di);
      msg.substring(di, de).toCharArray(filterDesc, sizeof(filterDesc));
    }
    currentState = TAG_KNOWN;
    screenKnownTag();

  } else if (msg.indexOf("\"known\":false") >= 0) {
    currentState = TAG_NEW;
    screenNewTag();

  } else if (msg.indexOf("\"generated\":true") >= 0) {
    int ni = msg.indexOf("\"name\":\"");
    if (ni >= 0) {
      ni += 8;
      int ne = msg.indexOf("\"", ni);
      msg.substring(ni, ne).toCharArray(filterName, sizeof(filterName));
    }
    int di = msg.indexOf("\"desc\":\"");
    if (di >= 0) {
      di += 8;
      int de = msg.indexOf("\"", di);
      msg.substring(di, de).toCharArray(filterDesc, sizeof(filterDesc));
    }
    currentState = FILTER_SAVED;
    screenFilterSaved();
  }
}

void checkSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      serialBuf.trim();
      if (serialBuf.startsWith("{")) {
        handleLaptopMessage(serialBuf);
      }
      serialBuf = "";
    } else {
      serialBuf += c;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// I2S / MIC
// ─────────────────────────────────────────────────────────────────────────────
void i2sInit() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = 16000,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = i2s_comm_format_t(I2S_COMM_FORMAT_STAND_I2S),
    .dma_buf_count = 8,
    .dma_buf_len = 512
  };
  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_SCK,
    .ws_io_num  = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num  = I2S_SD
  };
  i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_PORT, &pin_config);
}

void streamMic() {
  int32_t sample = 0;
  size_t bytes_read = 0;
  i2s_read(I2S_PORT, &sample, sizeof(sample), &bytes_read, pdMS_TO_TICKS(5));
  if (bytes_read > 0) {
    int16_t sample16 = (int16_t)(sample >> 16);
    Serial.write((uint8_t*)&sample16, 2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────
void setup() {
  pinMode(47, OUTPUT);
  digitalWrite(47, LOW);
  pinMode(LISTEN_BTN,  INPUT_PULLUP);
  pinMode(CART_BTN,    INPUT_PULLUP);
  pinMode(CONFIRM_BTN, INPUT_PULLUP);
  pinMode(LED_PIN,     OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.begin(921600);
  delay(500);

  Serial.println("init e-ink...");
  epd.Init(FULL);
  epd.Clear();
  screenIdle();
  Serial.println("e-ink ready");

  Serial.println("init nfc...");
  Wire.begin(SDA_PIN, SCL_PIN);
  nfc.begin();
  uint32_t ver = nfc.getFirmwareVersion();
  if (!ver) {
    Serial.println("ERROR: PN532 not found");
  } else {
    nfc.SAMConfig();
    Serial.println("nfc ready");
  }

  Serial.println("init i2s...");
  i2sInit();

  Serial.println("READY");
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOP
// ─────────────────────────────────────────────────────────────────────────────
void loop() {
  checkNfc();
  checkSerial();

  // ── ACTIVE FILTER ────────────────────────────────────────────────────────
  if (currentState == ACTIVE_FILTER) {
    if (buttonPressed(listenBtn) && !isListening) {
      isListening = true;
      digitalWrite(LED_PIN, HIGH);
      Serial.println("START");
    }
    if (buttonReleased(listenBtn) && isListening) {
      isListening = false;
      digitalWrite(LED_PIN, LOW);
      Serial.println("STOP");
    }
    if (isListening) streamMic();
    return;
  }

  // ── TAG_KNOWN ────────────────────────────────────────────────────────────
  if (currentState == TAG_KNOWN) {
    if (buttonPressed(confirmBtn)) {
      currentState = ACTIVE_FILTER;
      screenActiveFilter();
    }
    if (buttonPressed(cartBtn)) {
      currentState = RECORDING_CARTRIDGE;
      isCartRecording = true;
      Serial.println("CART_START");
      screenRecording();
    }
    return;
  }

  // ── TAG_NEW ──────────────────────────────────────────────────────────────
  if (currentState == TAG_NEW) {
    if (buttonPressed(cartBtn)) {
      currentState = RECORDING_CARTRIDGE;
      isCartRecording = true;
      Serial.println("CART_START");
      screenRecording();
    }
    return;
  }

  // ── RECORDING_CARTRIDGE ──────────────────────────────────────────────────
  if (currentState == RECORDING_CARTRIDGE) {
    if (isCartRecording) streamMic();
    if (buttonPressed(cartBtn)) {
      isCartRecording = false;
      Serial.println("CART_STOP");
      Serial.print("{\"save_uid\":\"");
      Serial.print(currentUid);
      Serial.println("\"}");
      currentState = GENERATING;
      screenGenerating();
    }
    return;
  }

  // ── FILTER_SAVED ─────────────────────────────────────────────────────────
  if (currentState == FILTER_SAVED) {
    if (buttonPressed(confirmBtn)) {
      currentState = ACTIVE_FILTER;
      screenActiveFilter();
    }
    return;
  }
}

