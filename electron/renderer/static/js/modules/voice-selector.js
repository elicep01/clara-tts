// Clara - Voice Selector Module
// Handles TTS voice selection and management

export class VoiceSelectorManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
        this.voices = [];
        this.currentVoiceId = null;
        this.previewAudio = null;
        this.filteredVoices = [];
        this.pendingVoiceChange = null; // Track pending voice changes

        // Locale code to friendly name mapping
        this.localeNames = {
            'af-ZA': 'Afrikaans (South Africa)',
            'am-ET': 'Amharic (Ethiopia)',
            'ar-AE': 'Arabic (UAE)',
            'ar-BH': 'Arabic (Bahrain)',
            'ar-DZ': 'Arabic (Algeria)',
            'ar-EG': 'Arabic (Egypt)',
            'ar-IQ': 'Arabic (Iraq)',
            'ar-JO': 'Arabic (Jordan)',
            'ar-KW': 'Arabic (Kuwait)',
            'ar-LB': 'Arabic (Lebanon)',
            'ar-LY': 'Arabic (Libya)',
            'ar-MA': 'Arabic (Morocco)',
            'ar-OM': 'Arabic (Oman)',
            'ar-QA': 'Arabic (Qatar)',
            'ar-SA': 'Arabic (Saudi Arabia)',
            'ar-SY': 'Arabic (Syria)',
            'ar-TN': 'Arabic (Tunisia)',
            'ar-YE': 'Arabic (Yemen)',
            'az-AZ': 'Azerbaijani',
            'bg-BG': 'Bulgarian',
            'bn-BD': 'Bengali (Bangladesh)',
            'bn-IN': 'Bengali (India)',
            'bs-BA': 'Bosnian',
            'ca-ES': 'Catalan (Spain)',
            'cs-CZ': 'Czech',
            'cy-GB': 'Welsh',
            'da-DK': 'Danish',
            'de-AT': 'German (Austria)',
            'de-CH': 'German (Switzerland)',
            'de-DE': 'German (Germany)',
            'el-GR': 'Greek',
            'en-AU': 'English (Australia)',
            'en-CA': 'English (Canada)',
            'en-GB': 'English (UK)',
            'en-HK': 'English (Hong Kong)',
            'en-IE': 'English (Ireland)',
            'en-IN': 'English (India)',
            'en-KE': 'English (Kenya)',
            'en-NG': 'English (Nigeria)',
            'en-NZ': 'English (New Zealand)',
            'en-PH': 'English (Philippines)',
            'en-SG': 'English (Singapore)',
            'en-TZ': 'English (Tanzania)',
            'en-US': 'English (US)',
            'en-ZA': 'English (South Africa)',
            'es-AR': 'Spanish (Argentina)',
            'es-BO': 'Spanish (Bolivia)',
            'es-CL': 'Spanish (Chile)',
            'es-CO': 'Spanish (Colombia)',
            'es-CR': 'Spanish (Costa Rica)',
            'es-CU': 'Spanish (Cuba)',
            'es-DO': 'Spanish (Dominican Republic)',
            'es-EC': 'Spanish (Ecuador)',
            'es-ES': 'Spanish (Spain)',
            'es-GQ': 'Spanish (Equatorial Guinea)',
            'es-GT': 'Spanish (Guatemala)',
            'es-HN': 'Spanish (Honduras)',
            'es-MX': 'Spanish (Mexico)',
            'es-NI': 'Spanish (Nicaragua)',
            'es-PA': 'Spanish (Panama)',
            'es-PE': 'Spanish (Peru)',
            'es-PR': 'Spanish (Puerto Rico)',
            'es-PY': 'Spanish (Paraguay)',
            'es-SV': 'Spanish (El Salvador)',
            'es-US': 'Spanish (US)',
            'es-UY': 'Spanish (Uruguay)',
            'es-VE': 'Spanish (Venezuela)',
            'et-EE': 'Estonian',
            'eu-ES': 'Basque',
            'fa-IR': 'Persian (Iran)',
            'fi-FI': 'Finnish',
            'fil-PH': 'Filipino',
            'fr-BE': 'French (Belgium)',
            'fr-CA': 'French (Canada)',
            'fr-CH': 'French (Switzerland)',
            'fr-FR': 'French (France)',
            'ga-IE': 'Irish',
            'gl-ES': 'Galician',
            'gu-IN': 'Gujarati (India)',
            'he-IL': 'Hebrew (Israel)',
            'hi-IN': 'Hindi (India)',
            'hr-HR': 'Croatian',
            'hu-HU': 'Hungarian',
            'hy-AM': 'Armenian',
            'id-ID': 'Indonesian',
            'is-IS': 'Icelandic',
            'it-IT': 'Italian',
            'ja-JP': 'Japanese',
            'jv-ID': 'Javanese',
            'ka-GE': 'Georgian',
            'kk-KZ': 'Kazakh',
            'km-KH': 'Khmer (Cambodia)',
            'kn-IN': 'Kannada (India)',
            'ko-KR': 'Korean',
            'lo-LA': 'Lao',
            'lt-LT': 'Lithuanian',
            'lv-LV': 'Latvian',
            'mk-MK': 'Macedonian',
            'ml-IN': 'Malayalam (India)',
            'mn-MN': 'Mongolian',
            'mr-IN': 'Marathi (India)',
            'ms-MY': 'Malay (Malaysia)',
            'mt-MT': 'Maltese',
            'my-MM': 'Burmese (Myanmar)',
            'nb-NO': 'Norwegian Bokmål',
            'ne-NP': 'Nepali',
            'nl-BE': 'Dutch (Belgium)',
            'nl-NL': 'Dutch (Netherlands)',
            'pa-IN': 'Punjabi (India)',
            'pl-PL': 'Polish',
            'ps-AF': 'Pashto (Afghanistan)',
            'pt-BR': 'Portuguese (Brazil)',
            'pt-PT': 'Portuguese (Portugal)',
            'ro-RO': 'Romanian',
            'ru-RU': 'Russian',
            'si-LK': 'Sinhala (Sri Lanka)',
            'sk-SK': 'Slovak',
            'sl-SI': 'Slovenian',
            'so-SO': 'Somali',
            'sq-AL': 'Albanian',
            'sr-RS': 'Serbian',
            'su-ID': 'Sundanese',
            'sv-SE': 'Swedish',
            'sw-KE': 'Swahili (Kenya)',
            'sw-TZ': 'Swahili (Tanzania)',
            'ta-IN': 'Tamil (India)',
            'ta-LK': 'Tamil (Sri Lanka)',
            'ta-MY': 'Tamil (Malaysia)',
            'ta-SG': 'Tamil (Singapore)',
            'te-IN': 'Telugu (India)',
            'th-TH': 'Thai',
            'tr-TR': 'Turkish',
            'uk-UA': 'Ukrainian',
            'ur-IN': 'Urdu (India)',
            'ur-PK': 'Urdu (Pakistan)',
            'uz-UZ': 'Uzbek',
            'vi-VN': 'Vietnamese',
            'wuu-CN': 'Wu Chinese',
            'yue-CN': 'Cantonese (China)',
            'zh-CN': 'Chinese (Mandarin)',
            'zh-HK': 'Chinese (Hong Kong)',
            'zh-TW': 'Chinese (Taiwan)',
            'zu-ZA': 'Zulu'
        };

        // Clara-specific preview samples (10 seconds each for fast generation)
        this.previewSamples = [
            "Hello! I'm Clara, your study companion. I read documents aloud while highlighting each word, helping you learn better.",
            "Clara highlights words as I speak and lets you click any word for its definition. Adjust speed and take notes easily.",
            "Combining listening with reading improves memory and focus. Clara makes studying more effective and enjoyable."
        ];
    }

    // Get friendly name for a locale code
    getLocaleName(locale) {
        return this.localeNames[locale] || locale;
    }

    // Get preview sample text by index
    getPreviewSample(index) {
        return this.previewSamples[index] || this.previewSamples[0];
    }

    setup() {
        // Quick voice dropdown in nav
        const btn = document.getElementById('btn-voice');
        const dropdown = document.getElementById('voice-dropdown');

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });

        document.addEventListener('click', () => {
            dropdown.classList.add('hidden');
        });

        document.querySelectorAll('.voice-option').forEach(option => {
            option.addEventListener('click', async (e) => {
                e.stopPropagation();
                const voice = option.dataset.voice;

                // Cancel any pending voice change
                if (this.pendingVoiceChange) {
                    this.pendingVoiceChange.cancelled = true;
                }

                // Update backend voice setting
                try {
                    await fetch('/tts/voice', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ voice_id: voice })
                    });
                } catch (err) {
                    console.error('Failed to update voice:', err);
                }

                this.state.selectedVoice = voice;
                this.currentVoiceId = voice;

                document.querySelectorAll('.voice-option').forEach(o => o.classList.remove('active'));
                option.classList.add('active');

                dropdown.classList.add('hidden');
                this.clara.ui.showToast(`Voice changed to ${option.querySelector('.voice-name').textContent}`);

                // If currently reading, regenerate audio with new voice
                if (this.state.isReadingMode) {
                    const wasPlaying = this.state.isPlaying;
                    const currentWordIndex = this.state.currentWordIndex;

                    console.log('[VoiceSelector] Voice changed during reading, preserving word index:', currentWordIndex);

                    // Create cancellation token for this voice change
                    const changeToken = { cancelled: false };
                    this.pendingVoiceChange = changeToken;

                    // Pause current audio if playing
                    if (wasPlaying && this.clara.reading.audio) {
                        this.clara.reading.audio.pause();
                    }

                    // Store current word index
                    this.state.currentWordIndex = currentWordIndex;

                    // Regenerate audio with new voice
                    await this.clara.reading.playPageAudio();

                    // Check if this voice change was cancelled
                    if (changeToken.cancelled) {
                        return; // Don't do anything, a newer voice change is in progress
                    }

                    // Clear the pending change
                    this.pendingVoiceChange = null;

                    // playPageAudio already handles resuming playback, but we need to ensure
                    // it doesn't auto-play if it was paused
                    if (!wasPlaying && this.clara.reading.audio) {
                        this.clara.reading.audio.pause();
                    }
                }
            });
        });

        // Settings modal voice tab handlers
        this.setupSettingsVoiceTab();
    }

    setupSettingsVoiceTab() {
        // Language filter
        const langFilter = document.getElementById('voice-language-filter');
        if (langFilter) {
            langFilter.addEventListener('change', () => this.applyFilters());
        }

        // Gender filter
        const genderFilter = document.getElementById('voice-gender-filter');
        if (genderFilter) {
            genderFilter.addEventListener('change', () => this.applyFilters());
        }
    }

    async loadVoices() {
        const voiceList = document.getElementById('voice-list');
        const langFilter = document.getElementById('voice-language-filter');

        if (!voiceList) return;

        voiceList.innerHTML = '<div class="voice-loading"><div class="spinner"></div><span>Loading voices...</span></div>';

        try {
            const res = await fetch('/tts/voices');
            const data = await res.json();

            if (data.error) {
                voiceList.innerHTML = `<div class="llm-empty">Error: ${data.error}</div>`;
                return;
            }

            this.voices = data.voices || [];
            this.filteredVoices = [...this.voices];

            // Populate language filter with friendly names
            if (langFilter) {
                const languages = [...new Set(this.voices.map(v => v.language))].sort();
                langFilter.innerHTML = '<option value="">All Languages</option>';
                languages.forEach(lang => {
                    const friendlyName = this.getLocaleName(lang);
                    langFilter.innerHTML += `<option value="${lang}">${friendlyName}</option>`;
                });
            }

            // Load current voice
            await this.loadCurrentVoice();

            // Render voice list
            this.renderVoiceList();

        } catch (err) {
            voiceList.innerHTML = `<div class="llm-empty">Failed to load voices: ${err.message}</div>`;
        }
    }

    async loadCurrentVoice() {
        try {
            const res = await fetch('/tts/voice');
            const data = await res.json();
            this.currentVoiceId = data.voice_id;

            // Update current voice display
            const display = document.getElementById('current-voice-display');
            if (display) {
                const voice = this.voices.find(v => v.id === this.currentVoiceId);
                if (voice) {
                    const friendlyLang = this.getLocaleName(voice.language);
                    display.innerHTML = `
                        <span class="current-voice-name">${voice.name}</span>
                        <span class="current-voice-meta">${friendlyLang} · ${voice.gender}</span>
                    `;
                } else {
                    display.innerHTML = `<span class="current-voice-name">${this.currentVoiceId}</span>`;
                }
            }
        } catch (err) {
            console.log('Could not load current voice:', err);
        }
    }

    applyFilters() {
        const langFilter = document.getElementById('voice-language-filter');
        const genderFilter = document.getElementById('voice-gender-filter');

        const lang = langFilter?.value || '';
        const gender = genderFilter?.value || '';

        this.filteredVoices = this.voices.filter(v => {
            if (lang && v.language !== lang) return false;
            if (gender && v.gender !== gender) return false;
            return true;
        });

        this.renderVoiceList();
    }

    renderVoiceList() {
        const voiceList = document.getElementById('voice-list');
        if (!voiceList) return;

        if (this.filteredVoices.length === 0) {
            voiceList.innerHTML = '<div class="llm-empty">No voices match your filters</div>';
            return;
        }

        voiceList.innerHTML = '';

        this.filteredVoices.forEach(voice => {
            const isActive = voice.id === this.currentVoiceId;
            const item = document.createElement('div');
            item.className = `voice-item${isActive ? ' active' : ''}`;
            item.dataset.voiceId = voice.id;

            const friendlyLang = this.getLocaleName(voice.language);
            item.innerHTML = `
                <div class="voice-item-info">
                    <div class="voice-item-name">${voice.name}</div>
                    <div class="voice-item-meta">${friendlyLang} · ${voice.gender}${voice.style ? ' · ' + voice.style : ''}</div>
                </div>
                <div class="voice-item-actions">
                    <button class="btn-preview-voice" data-voice-id="${voice.id}">Preview</button>
                    <span class="voice-check">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </span>
                </div>
            `;

            // Click to select voice
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('btn-preview-voice')) return;
                this.selectVoice(voice.id);
            });

            // Preview button
            const previewBtn = item.querySelector('.btn-preview-voice');
            previewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.previewVoice(voice.id, previewBtn);
            });

            voiceList.appendChild(item);
        });
    }

    async selectVoice(voiceId) {
        try {
            // Cancel any pending voice change
            if (this.pendingVoiceChange) {
                this.pendingVoiceChange.cancelled = true;
            }

            const res = await fetch('/tts/voice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voice_id: voiceId })
            });

            const data = await res.json();

            if (data.error) {
                this.clara.ui.showToast(data.error, true);
                return;
            }

            this.currentVoiceId = voiceId;
            this.state.selectedVoice = voiceId;

            // Update UI
            document.querySelectorAll('.voice-item').forEach(item => {
                item.classList.toggle('active', item.dataset.voiceId === voiceId);
            });

            // Update current voice display
            await this.loadCurrentVoice();

            const voice = this.voices.find(v => v.id === voiceId);
            this.clara.ui.showToast(`Voice changed to ${voice?.name || voiceId}`);

            // If currently reading, regenerate audio with new voice
            if (this.state.isReadingMode) {
                const wasPlaying = this.state.isPlaying;
                const currentWordIndex = this.state.currentWordIndex;

                console.log('[VoiceSelector] Voice changed from settings, preserving word index:', currentWordIndex);

                // Create cancellation token for this voice change
                const changeToken = { cancelled: false };
                this.pendingVoiceChange = changeToken;

                // Pause current audio if playing
                if (wasPlaying && this.clara.reading.audio) {
                    this.clara.reading.audio.pause();
                }

                // Store current word index
                this.state.currentWordIndex = currentWordIndex;

                // Regenerate audio with new voice
                await this.clara.reading.playPageAudio();

                // Check if this voice change was cancelled
                if (changeToken.cancelled) {
                    return; // Don't do anything, a newer voice change is in progress
                }

                // Clear the pending change
                this.pendingVoiceChange = null;

                // playPageAudio already handles resuming playback, but we need to ensure
                // it doesn't auto-play if it was paused
                if (!wasPlaying && this.clara.reading.audio) {
                    this.clara.reading.audio.pause();
                }
            }

        } catch (err) {
            this.clara.ui.showToast('Failed to change voice: ' + err.message, true);
            this.clara.ui.hideInlineLoading();
        }
    }

    async previewVoice(voiceId, buttonElement) {
        // Stop any current preview
        if (this.previewAudio) {
            this.previewAudio.pause();
            this.previewAudio = null;
            document.querySelectorAll('.btn-preview-voice.playing').forEach(btn => {
                btn.classList.remove('playing');
                btn.textContent = 'Preview';
            });
        }

        // If clicking the same button that was playing, just stop
        if (buttonElement.classList.contains('playing')) {
            return;
        }

        const sampleSelect = document.getElementById('voice-sample-select');
        const sampleIndex = parseInt(sampleSelect?.value || 0);
        const sampleText = this.getPreviewSample(sampleIndex);
        const statusEl = document.getElementById('voice-preview-status');

        buttonElement.classList.add('playing');
        buttonElement.textContent = 'Loading...';
        if (statusEl) statusEl.textContent = 'Generating...';

        try {
            const res = await fetch('/tts/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voice_id: voiceId, text: sampleText })
            });

            if (!res.ok) {
                throw new Error('Preview failed');
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);

            this.previewAudio = new Audio(url);
            buttonElement.textContent = 'Playing...';
            if (statusEl) statusEl.textContent = 'Playing...';

            this.previewAudio.onended = () => {
                buttonElement.classList.remove('playing');
                buttonElement.textContent = 'Preview';
                if (statusEl) statusEl.textContent = '';
                URL.revokeObjectURL(url);
                this.previewAudio = null;
            };

            this.previewAudio.onerror = () => {
                buttonElement.classList.remove('playing');
                buttonElement.textContent = 'Preview';
                if (statusEl) statusEl.textContent = 'Error';
                URL.revokeObjectURL(url);
                this.previewAudio = null;
            };

            await this.previewAudio.play();

        } catch (err) {
            buttonElement.classList.remove('playing');
            buttonElement.textContent = 'Preview';
            if (statusEl) statusEl.textContent = 'Error';
            this.clara.ui.showToast('Preview failed: ' + err.message, true);
        }
    }
}