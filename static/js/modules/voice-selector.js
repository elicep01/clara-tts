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

                    // Pause current audio if playing
                    if (wasPlaying && this.clara.reading.audio) {
                        this.clara.reading.audio.pause();
                    }

                    // Store current word index
                    this.state.currentWordIndex = currentWordIndex;

                    // Regenerate audio with new voice
                    await this.clara.reading.playPageAudio();

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

            // Populate language filter
            if (langFilter) {
                const languages = [...new Set(this.voices.map(v => v.language))].sort();
                langFilter.innerHTML = '<option value="">All Languages</option>';
                languages.forEach(lang => {
                    langFilter.innerHTML += `<option value="${lang}">${lang}</option>`;
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
                    display.innerHTML = `
                        <span class="current-voice-name">${voice.name}</span>
                        <span class="current-voice-meta">${voice.language} · ${voice.gender}</span>
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

            item.innerHTML = `
                <div class="voice-item-info">
                    <div class="voice-item-name">${voice.name}</div>
                    <div class="voice-item-meta">${voice.language} · ${voice.gender}${voice.style ? ' · ' + voice.style : ''}</div>
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

                // Pause current audio if playing
                if (wasPlaying && this.clara.reading.audio) {
                    this.clara.reading.audio.pause();
                }

                // Store current word index
                this.state.currentWordIndex = currentWordIndex;

                // Regenerate audio with new voice
                await this.clara.reading.playPageAudio();

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
        const sampleIndex = sampleSelect?.value || 0;
        const statusEl = document.getElementById('voice-preview-status');

        buttonElement.classList.add('playing');
        buttonElement.textContent = 'Loading...';
        if (statusEl) statusEl.textContent = 'Generating...';

        try {
            const res = await fetch('/tts/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voice_id: voiceId, sample_index: parseInt(sampleIndex) })
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