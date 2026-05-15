let lastAudioId = 0;

async function pollAudio() {
  try {
    const r = await fetch(`/api/audio/latest?since=${lastAudioId}`);
    if (r.status === 200) {
      const id = parseInt(r.headers.get('X-Audio-Id'));
      lastAudioId = id;
      const buf = await r.arrayBuffer();
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(buf);
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(ctx.destination);
      source.start();
      console.log('Playing audio', id);
    }
  } catch (e) {
    console.error('Audio poll error:', e);
  }
  setTimeout(pollAudio, 500);  // poll every 500ms
}

// start polling when page loads
pollAudio();