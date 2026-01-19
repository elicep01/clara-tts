// Clara - Dictionary Lookup Module
// Handles word lookup and popup display

export class DictionaryManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
        this.handleClickOutside = this.handleClickOutside.bind(this);
    }

    async lookup(word, targetElement) {
        const cleanWord = word.replace(/[^\w'-]/g, '').toLowerCase();

        if (!cleanWord || cleanWord.length < 2) {
            this.clara.ui.showToast('Select a valid word', true);
            return;
        }

        const wasPlaying = this.state.isPlaying;
        if (wasPlaying) {
            this.clara.reading.pause();
        }

        this.showPopup(targetElement, cleanWord, null, true);

        try {
            const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);

            if (!res.ok) {
                this.showPopup(targetElement, cleanWord, {
                    error: true,
                    message: 'No definition found for this word.'
                });
                return;
            }

            const data = await res.json();

            if (data && data.length > 0) {
                this.showPopup(targetElement, cleanWord, data[0]);
            } else {
                this.showPopup(targetElement, cleanWord, {
                    error: true,
                    message: 'No definition found.'
                });
            }
        } catch (err) {
            this.showPopup(targetElement, cleanWord, {
                error: true,
                message: 'Could not connect to dictionary service.'
            });
        }
    }

    showPopup(targetElement, word, data, isLoading = false) {
        this.hidePopup();

        const popup = document.createElement('div');
        popup.id = 'dictionary-popup';
        popup.className = 'dictionary-popup';

        const rect = targetElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let top = rect.bottom + 10;
        let left = rect.left;

        if (top + 300 > viewportHeight) {
            top = rect.top - 310;
        }
        if (left + 320 > viewportWidth) {
            left = viewportWidth - 340;
        }
        if (left < 20) {
            left = 20;
        }

        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;

        if (isLoading) {
            popup.innerHTML = `
                <div class="dict-header">
                    <span class="dict-word">${this.clara.ui.escapeHtml(word)}</span>
                    <button class="dict-close" onclick="window.clara.dictionary.hidePopup()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div class="dict-loading">
                    <div class="spinner"></div>
                    <span>Looking up...</span>
                </div>
            `;
        } else if (data && data.error) {
            popup.innerHTML = `
                <div class="dict-header">
                    <span class="dict-word">${this.clara.ui.escapeHtml(word)}</span>
                    <button class="dict-close" onclick="window.clara.dictionary.hidePopup()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div class="dict-error">${this.clara.ui.escapeHtml(data.message)}</div>
            `;
        } else if (data) {
            let phonetic = '';
            if (data.phonetic) {
                phonetic = data.phonetic;
            } else if (data.phonetics && data.phonetics.length > 0) {
                const ph = data.phonetics.find(p => p.text);
                if (ph) phonetic = ph.text;
            }

            let audioUrl = '';
            if (data.phonetics) {
                const phWithAudio = data.phonetics.find(p => p.audio);
                if (phWithAudio) audioUrl = phWithAudio.audio;
            }

            let meaningsHtml = '';
            if (data.meanings && data.meanings.length > 0) {
                data.meanings.slice(0, 3).forEach(meaning => {
                    meaningsHtml += `<div class="dict-meaning">`;
                    meaningsHtml += `<span class="dict-pos">${this.clara.ui.escapeHtml(meaning.partOfSpeech)}</span>`;

                    if (meaning.definitions && meaning.definitions.length > 0) {
                        meaning.definitions.slice(0, 2).forEach((def, idx) => {
                            meaningsHtml += `<div class="dict-def">${idx + 1}. ${this.clara.ui.escapeHtml(def.definition)}</div>`;
                            if (def.example) {
                                meaningsHtml += `<div class="dict-example">"${this.clara.ui.escapeHtml(def.example)}"</div>`;
                            }
                        });
                    }
                    meaningsHtml += `</div>`;
                });
            }

            popup.innerHTML = `
                <div class="dict-header">
                    <div class="dict-title-row">
                        <span class="dict-word">${this.clara.ui.escapeHtml(word)}</span>
                        ${phonetic ? `<span class="dict-phonetic">${this.clara.ui.escapeHtml(phonetic)}</span>` : ''}
                        ${audioUrl ? `<button class="dict-audio-btn" onclick="window.clara.dictionary.playAudio('${audioUrl}')">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                                <path d="M15.54 8.46a5 5 0 010 7.07"/>
                            </svg>
                        </button>` : ''}
                    </div>
                    <button class="dict-close" onclick="window.clara.dictionary.hidePopup()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                <div class="dict-content">
                    ${meaningsHtml}
                </div>
            `;
        }

        document.body.appendChild(popup);

        setTimeout(() => {
            document.addEventListener('click', this.handleClickOutside);
        }, 100);
    }

    handleClickOutside(e) {
        const popup = document.getElementById('dictionary-popup');
        if (popup && !popup.contains(e.target) && !e.target.closest('.word-box')) {
            this.hidePopup();
        }
    }

    hidePopup() {
        const popup = document.getElementById('dictionary-popup');
        if (popup) {
            popup.remove();
        }
        document.removeEventListener('click', this.handleClickOutside);
    }

    playAudio(url) {
        if (url) {
            const audio = new Audio(url);
            audio.play().catch(err => console.log('Could not play pronunciation'));
        }
    }
}