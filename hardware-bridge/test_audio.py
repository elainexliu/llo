import serial
import wave
import os
import sys
import threading

PORT = 'COM5'
BAUD = 921600
SAMPLE_RATE = 16000
OUTPUT_FILE = 'test_recording.wav'

ser = serial.Serial(PORT, BAUD, timeout=0.1)
print(f"Opened {PORT} at {BAUD} baud")
print("Press the button to record, release to stop")

recording = False
audio_bytes = bytearray()
lock = threading.Lock()

def save_and_play(pcm_bytes):
    with wave.open(OUTPUT_FILE, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm_bytes)
    duration = len(pcm_bytes) / (SAMPLE_RATE * 2)
    print(f"Saved {len(pcm_bytes)} bytes, {duration:.1f} seconds → {OUTPUT_FILE}")
    if sys.platform == 'win32':
        os.system(f'start {OUTPUT_FILE}')
    elif sys.platform == 'darwin':
        os.system(f'afplay {OUTPUT_FILE}')
    else:
        os.system(f'aplay {OUTPUT_FILE}')

# Read lines in a separate thread to catch START/STOP reliably
def line_reader():
    global recording, audio_bytes
    buf = b''
    while True:
        byte = ser.read(1)
        if not byte:
            continue
        with lock:
            if recording:
                # In recording mode, check if this byte starts "STOP\n"
                buf += byte
                if b'STOP' in buf:
                    recording = False
                    captured = bytes(audio_bytes)
                    audio_bytes = bytearray()
                    buf = b''
                    print("Recording stopped")
                    if captured:
                        save_and_play(captured)
                    else:
                        print("No audio captured")
                    print("\nReady for next recording")
                elif len(buf) > 6:
                    # Not a STOP sequence — it's audio data, flush to buffer
                    audio_bytes.extend(buf[:-4])
                    buf = buf[-4:]
            else:
                buf += byte
                if buf.endswith(b'\n'):
                    line = buf.decode('utf-8', errors='ignore').strip()
                    buf = b''
                    if line:
                        print(f"< {line}")
                    if line == 'START':
                        recording = True
                        audio_bytes = bytearray()
                        print("Recording started — release button to stop")

t = threading.Thread(target=line_reader, daemon=True)
t.start()

try:
    t.join()
except KeyboardInterrupt:
    print("\nDone")
    ser.close() 