import {
  KNOB_DEFS,
  knobValues,
  histories,
  callOpenAI,
  pushExchange,
} from './filter-engine.js';

/** ATmega32U4 Pro Micro: 10-bit ADC (0–1023). ESP32 12-bit builds: use 4095. */
const ADC_MAX = 1023;

function rawToPercent(raw) {
  const n = Math.round((Number(raw) / ADC_MAX) * 100);
  return Math.max(0, Math.min(100, n));
}

function renderKnobs() {
  KNOB_DEFS.forEach((k) => {
    const pct = knobValues[k.id];
    const row = document.querySelector(`[data-knob-row="${k.id}"]`);
    if (!row) return;
    const input = row.querySelector('.knob-slider');
    if (input) {
      input.value = String(pct);
      input.style.setProperty('--pct', `${pct}%`);
    }
    const valSpan = row.querySelector('.knob-val');
    if (valSpan) valSpan.textContent = String(pct);
  });
}

function buildKnobRows() {
  const container = document.getElementById('knobs');
  KNOB_DEFS.forEach((k) => {
    const v = knobValues[k.id];
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="knob-row" data-knob-row="${k.id}">
        <span class="knob-name">${k.label}</span>
        <input type="range" class="knob-slider" min="0" max="100" value="${v}"
          style="--pct:${v}%"
          data-knob="${k.id}">
        <span class="knob-val">${v}</span>
      </div>
      <div class="knob-labels"><span>${k.lo}</span><span>${k.hi}</span></div>
    `;
    container.appendChild(wrap);
    const input = wrap.querySelector('.knob-slider');
    input.addEventListener('input', function () {
      const id = this.dataset.knob;
      const val = parseInt(this.value, 10);
      knobValues[id] = val;
      this.style.setProperty('--pct', `${val}%`);
      this.nextElementSibling.textContent = String(val);
    });
  });
}

function applySerialPayload(obj) {
  let changed = false;
  KNOB_DEFS.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(obj, k.id)) {
      knobValues[k.id] = rawToPercent(obj[k.id]);
      changed = true;
    }
  });
  if (changed) renderKnobs();
}

// ─── Web Serial (Chrome / Edge, localhost or HTTPS) ─────────────────────────
let port;
let readerAbort;

async function connectSerial() {
  if (!('serial' in navigator)) {
    document.getElementById('serial-status').textContent =
      'Web Serial not supported — use Chrome or Edge on localhost';
    return;
  }

  const btn = document.getElementById('btn-serial');
  if (port && port.readable) {
    try {
      readerAbort?.abort();
      await port.close();
    } catch (_) { /* ignore */ }
    port = undefined;
    btn.textContent = 'Connect serial';
    document.getElementById('serial-status').textContent = 'Disconnected';
    return;
  }

  port = await navigator.serial.requestPort();
  await port.open({ baudRate: 115200 });

  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable);
  const lineReader = decoder.readable.getReader();
  readerAbort = new AbortController();
  const signal = readerAbort.signal;

  btn.textContent = 'Disconnect';
  document.getElementById('serial-status').textContent = 'Connected';

  (async function readLoop() {
    let buffer = '';
    try {
      while (!signal.aborted) {
        const { value, done } = await lineReader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t || t[0] !== '{') continue;
          try {
            applySerialPayload(JSON.parse(t));
          } catch (_) { /* incomplete line */ }
        }
      }
    } catch (e) {
      if (!signal.aborted) console.warn('Serial read:', e);
    }
  })();
}

// ─── Translate ───────────────────────────────────────────────────────────────
function updateMemoryBadge() {
  const badge = document.getElementById('mem-badge');
  const count = histories.length / 2;
  if (count === 0) {
    badge.textContent = 'no memory';
    badge.classList.remove('active');
  } else {
    badge.textContent = `${Math.round(count)} turn${count !== 1 ? 's' : ''} in memory`;
    badge.classList.add('active');
  }
}

async function translate() {
  const input = document.getElementById('received');
  const out = document.getElementById('translation');
  const msg = input.value.trim();
  if (!msg) return;

  const btn = document.getElementById('btn-translate');
  btn.disabled = true;
  out.value = '…';

  try {
    const filtered = await callOpenAI(msg);
    out.value = filtered;
    pushExchange(msg, filtered);
    updateMemoryBadge();
  } catch (e) {
    out.value = `[error] ${e.message}`;
  }
  btn.disabled = false;
}

function resetMemory() {
  histories.length = 0;
  updateMemoryBadge();
  document.getElementById('translation').value = '';
}

// ─── Init ────────────────────────────────────────────────────────────────────
buildKnobRows();
updateMemoryBadge();

document.getElementById('btn-serial').addEventListener('click', () => {
  connectSerial().catch((e) => {
    document.getElementById('serial-status').textContent = e.message || String(e);
  });
});

document.getElementById('btn-translate').addEventListener('click', translate);
document.getElementById('btn-reset').addEventListener('click', resetMemory);

document.getElementById('received').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    translate();
  }
});
