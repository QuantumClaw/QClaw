/**
 * QuantumClaw Voice Utilities
 *
 * STT (Speech-to-Text): Deepgram Nova-2 → OpenAI Whisper fallback
 * TTS (Text-to-Speech): ElevenLabs → OpenAI TTS fallback
 *
 * All methods accept/return Buffers for easy integration with channels.
 */

import { log } from '../core/logger.js';

export class VoiceEngine {
  constructor(secrets) {
    this.secrets = secrets;
  }

  // ─── Speech-to-Text ───────────────────────────────────

  /**
   * Transcribe audio buffer to text.
   * Tries Deepgram first (fastest, cheapest), then OpenAI Whisper.
   * @param {Buffer} audioBuffer - OGG/WebM/MP3/WAV audio
   * @param {string} mimeType - e.g. 'audio/ogg', 'audio/webm'
   * @returns {Promise<{text: string, provider: string, duration?: number}>}
   */
  async transcribe(audioBuffer, mimeType = 'audio/ogg') {
    // Try Deepgram first
    const deepgramKey = await this._getKey('deepgram_api_key');
    if (deepgramKey) {
      try {
        return await this._transcribeDeepgram(audioBuffer, mimeType, deepgramKey);
      } catch (err) {
        log.debug(`Deepgram STT failed: ${err.message}, trying Whisper...`);
      }
    }

    // Fallback: OpenAI Whisper
    const openaiKey = await this._getKey('openai_api_key');
    if (openaiKey) {
      try {
        return await this._transcribeWhisper(audioBuffer, mimeType, openaiKey);
      } catch (err) {
        log.debug(`Whisper STT failed: ${err.message}`);
      }
    }

    // Fallback: Groq Whisper (free tier)
    const groqKey = await this._getKey('groq_api_key');
    if (groqKey) {
      try {
        return await this._transcribeGroqWhisper(audioBuffer, mimeType, groqKey);
      } catch (err) {
        log.debug(`Groq Whisper STT failed: ${err.message}`);
      }
    }

    throw new Error('No STT provider available. Add a Deepgram, OpenAI, or Groq API key.');
  }

  async _transcribeDeepgram(buffer, mimeType, apiKey) {
    const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=en', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': mimeType,
      },
      body: buffer,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    const duration = data.metadata?.duration;
    return { text, provider: 'deepgram', duration };
  }

  async _transcribeWhisper(buffer, mimeType, apiKey) {
    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('webm') ? 'webm' : 'mp3';
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: mimeType }), `audio.${ext}`);
    formData.append('model', 'whisper-1');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error(`Whisper ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { text: data.text || '', provider: 'whisper' };
  }

  async _transcribeGroqWhisper(buffer, mimeType, apiKey) {
    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('webm') ? 'webm' : 'mp3';
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: mimeType }), `audio.${ext}`);
    formData.append('model', 'whisper-large-v3-turbo');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error(`Groq Whisper ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { text: data.text || '', provider: 'groq-whisper' };
  }

  // ─── Text-to-Speech ───────────────────────────────────

  /**
   * Convert text to audio buffer.
   * Tries ElevenLabs first (best quality), then OpenAI TTS.
   * @param {string} text - Text to speak
   * @param {object} options - { voice, speed }
   * @returns {Promise<{buffer: Buffer, mimeType: string, provider: string}>}
   */
  async synthesize(text, options = {}) {
    // Try ElevenLabs first
    const elevenKey = await this._getKey('elevenlabs_api_key');
    if (elevenKey) {
      try {
        return await this._synthesizeElevenLabs(text, elevenKey, options);
      } catch (err) {
        log.debug(`ElevenLabs TTS failed: ${err.message}, trying OpenAI...`);
      }
    }

    // Fallback: OpenAI TTS
    const openaiKey = await this._getKey('openai_api_key');
    if (openaiKey) {
      try {
        return await this._synthesizeOpenAI(text, openaiKey, options);
      } catch (err) {
        log.debug(`OpenAI TTS failed: ${err.message}`);
      }
    }

    throw new Error('No TTS provider available. Add an ElevenLabs or OpenAI API key.');
  }

  async _synthesizeElevenLabs(text, apiKey, options = {}) {
    // Default voice: Rachel (warm, professional)
    const voiceId = options.voice || 'EXAVITQu4vr4xnSDxMaL';
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.slice(0, 5000), // ElevenLabs limit
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          speed: options.speed || 1.0,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
    const arrayBuf = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuf), mimeType: 'audio/mpeg', provider: 'elevenlabs' };
  }

  async _synthesizeOpenAI(text, apiKey, options = {}) {
    const voice = options.voice || 'nova'; // nova = warm female, alloy = neutral
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text.slice(0, 4096),
        voice,
        speed: options.speed || 1.0,
        response_format: 'opus',
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
    const arrayBuf = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuf), mimeType: 'audio/ogg', provider: 'openai' };
  }

  // ─── Helpers ──────────────────────────────────────────

  async _getKey(name) {
    try {
      const val = await this.secrets.get(name);
      return val?.trim() || null;
    } catch { return null; }
  }

  /**
   * Check which voice services are available.
   */
  async status() {
    const stt = [];
    const tts = [];
    if (await this._getKey('deepgram_api_key')) stt.push('deepgram');
    if (await this._getKey('openai_api_key')) { stt.push('whisper'); tts.push('openai'); }
    if (await this._getKey('groq_api_key')) stt.push('groq-whisper');
    if (await this._getKey('elevenlabs_api_key')) tts.push('elevenlabs');
    return { stt, tts, ready: stt.length > 0 && tts.length > 0 };
  }
}
