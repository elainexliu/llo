/**
 * PN532 → USB serial JSON lines for hardware-bridge Web NFC connection.
 * Each successful read prints one line: {"nfc_uid":"<lowercase hex>"}
 *
 * Library: Adafruit PN532 (+ Adafruit BusIO). Wire = I2C.
 * Board: set IRQ/RST to -1 if unconnected (typical I2C breakout).
 */

#include <Wire.h>
#include <Adafruit_PN532.h>

Adafruit_PN532 nfc(-1, -1);

/** Ignore duplicate reads of same UID within this window (ms). */
const unsigned long DEBOUNCE_MS = 600;

static unsigned long lastEmitAt = 0;
static String lastUidHex = "";

void printUidJson(const uint8_t *uid, uint8_t len) {
  String hex;
  hex.reserve(len * 2 + 8);
  for (uint8_t i = 0; i < len; i++) {
    if (uid[i] < 16) hex += '0';
    hex += String(uid[i], HEX);
  }
  hex.toLowerCase();

  unsigned long now = millis();
  if (hex == lastUidHex && (now - lastEmitAt) < DEBOUNCE_MS) {
    return;
  }
  lastUidHex = hex;
  lastEmitAt = now;

  Serial.print(F("{\"nfc_uid\":\""));
  Serial.print(hex);
  Serial.println(F("\"}"));
}

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    delay(10);
  }

  Serial.println(F("{\"nfc_ready\":true}"));

  nfc.begin();

  uint32_t versiondata = nfc.getFirmwareVersion();
  if (!versiondata) {
    Serial.println(F("{\"nfc_error\":\"no_pn532\"}"));
    while (1) {
      delay(1000);
    }
  }

  nfc.SAMConfig();
}

void loop() {
  uint8_t uid[7];
  uint8_t uidLength;

  if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength)) {
    printUidJson(uid, uidLength);
    delay(300);
  }
}
