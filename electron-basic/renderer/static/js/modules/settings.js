// Clara - Settings Module
// Handles settings modal, LLM model management, and about tab

export class SettingsManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;

        // Reading settings defaults
        this.readingSettings = {
            highlightEnabled: true,
            showReadWords: true,
            autoAdvance: true
        };
    }

    setup() {
        // Settings button
        document.getElementById('btn-settings').addEventListener('click', () => {
            this.showModal();
        });

        // Close button
        document.getElementById('btn-close-settings').addEventListener('click', () => {
            this.hideModal();
        });

        // Backdrop click
        document.querySelector('#settings-modal .modal-backdrop').addEventListener('click', () => {
            this.hideModal();
        });

        // Tab switching
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // Refresh LLM status
        document.getElementById('btn-refresh-llm').addEventListener('click', () => {
            this.loadLLMStatus();
        });

        // Setup reading settings
        this.setupReadingSettings();
    }

    setupReadingSettings() {
        // Load saved settings from localStorage
        this.loadReadingSettings();

        // Setup toggle event listeners
        const highlightToggle = document.getElementById('setting-highlight-enabled');
        const showReadToggle = document.getElementById('setting-show-read-words');
        const autoAdvanceToggle = document.getElementById('setting-auto-advance');

        if (highlightToggle) {
            highlightToggle.checked = this.readingSettings.highlightEnabled;
            highlightToggle.addEventListener('change', (e) => {
                this.readingSettings.highlightEnabled = e.target.checked;
                this.saveReadingSettings();
                // Immediately apply change to current reading session
                this.applyReadingSettingChange('highlight', e.target.checked);
            });
        }

        if (showReadToggle) {
            showReadToggle.checked = this.readingSettings.showReadWords;
            showReadToggle.addEventListener('change', (e) => {
                this.readingSettings.showReadWords = e.target.checked;
                this.saveReadingSettings();
                // Immediately apply change to current reading session
                this.applyReadingSettingChange('readWords', e.target.checked);
            });
        }

        if (autoAdvanceToggle) {
            autoAdvanceToggle.checked = this.readingSettings.autoAdvance;
            autoAdvanceToggle.addEventListener('change', (e) => {
                this.readingSettings.autoAdvance = e.target.checked;
                this.saveReadingSettings();
            });
        }
    }

    loadReadingSettings() {
        try {
            const saved = localStorage.getItem('clara_reading_settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                this.readingSettings = { ...this.readingSettings, ...parsed };
            }
        } catch (e) {
            console.warn('Failed to load reading settings:', e);
        }
    }

    saveReadingSettings() {
        try {
            localStorage.setItem('clara_reading_settings', JSON.stringify(this.readingSettings));
        } catch (e) {
            console.warn('Failed to save reading settings:', e);
        }
    }

    getReadingSetting(key) {
        return this.readingSettings[key];
    }

    applyReadingSettingChange(setting, enabled) {
        // Immediately apply setting changes to the current reading session
        if (!this.clara.reading) return;

        if (setting === 'highlight') {
            if (!enabled) {
                // Remove all active highlights
                document.querySelectorAll('.word-box.active').forEach(el => {
                    el.classList.remove('active');
                });
            }
        } else if (setting === 'readWords') {
            if (!enabled) {
                // Remove all read word overlays
                document.querySelectorAll('.word-box.read').forEach(el => {
                    el.classList.remove('read');
                });
            }
        }
    }

    showModal() {
        document.getElementById('settings-modal').classList.remove('hidden');
        this.loadLLMStatus();
    }

    hideModal() {
        document.getElementById('settings-modal').classList.add('hidden');
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Update tab content
        document.querySelectorAll('.settings-tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `settings-tab-${tabName}`);
        });

        // Load data for specific tabs
        if (tabName === 'voices') {
            this.clara.voiceSelector.loadVoices();
        }
    }

    async loadLLMStatus(retryCount = 0) {
        const statusDot = document.getElementById('llm-status-dot');
        const statusText = document.getElementById('llm-status-text');
        const downloadedList = document.getElementById('downloaded-llm-list');
        const availableList = document.getElementById('available-llm-list');
        const helpSection = document.getElementById('llm-help-section');

        // Show loading state
        statusDot.className = 'status-dot loading';
        statusText.textContent = 'Checking...';
        downloadedList.innerHTML = '<div class="llm-loading"><div class="spinner"></div><span>Loading...</span></div>';
        availableList.innerHTML = '<div class="llm-loading"><div class="spinner"></div><span>Loading...</span></div>';

        try {
            const res = await fetch('/llm/status');
            const data = await res.json();

            // Update status indicator and help section visibility
            if (data.llm_available) {
                statusDot.className = 'status-dot active';
                statusText.textContent = `Active: ${data.current_model || 'Unknown'}`;
                // Hide help section when Ollama is working
                if (helpSection) helpSection.style.display = 'none';
            } else if (data.error) {
                statusDot.className = 'status-dot inactive';
                statusText.textContent = 'Initializing AI engine...';
                // Show help section when AI engine is not available
                if (helpSection) helpSection.style.display = 'none';

                // Retry after a delay if this is initial load
                if (retryCount < 3) {
                    setTimeout(() => this.loadLLMStatus(retryCount + 1), 2000);
                }
            } else {
                statusDot.className = 'status-dot inactive';
                statusText.textContent = 'No model loaded';
                if (helpSection) helpSection.style.display = 'none';
            }

            // Render downloaded models
            this.renderDownloadedModels(data.downloaded_models || [], data.current_model);

            // Render available models
            this.renderAvailableModels(data.available_models || [], data.downloaded_models || []);

        } catch (err) {
            // During initial load, show friendly initialization message
            if (retryCount < 3) {
                statusDot.className = 'status-dot loading';
                statusText.textContent = 'Initializing AI engine...';
                downloadedList.innerHTML = '<div class="llm-loading"><div class="spinner"></div><span>Setting up local AI...</span></div>';
                availableList.innerHTML = '<div class="llm-loading"><div class="spinner"></div><span>Setting up local AI...</span></div>';
                if (helpSection) helpSection.style.display = 'none';

                // Retry after delay
                setTimeout(() => this.loadLLMStatus(retryCount + 1), 2000);
            } else {
                // After retries, show that setup is needed
                statusDot.className = 'status-dot inactive';
                statusText.textContent = 'Setup needed';
                downloadedList.innerHTML = '<div class="llm-empty">Download a model to get started</div>';
                availableList.innerHTML = '<div class="llm-empty">AI engine not available</div>';
                if (helpSection) helpSection.style.display = 'none';
            }
        }
    }

    renderDownloadedModels(downloaded, currentModel) {
        const list = document.getElementById('downloaded-llm-list');

        if (!downloaded || downloaded.length === 0) {
            list.innerHTML = '<div class="llm-empty">No models downloaded yet</div>';
            return;
        }

        list.innerHTML = '';

        downloaded.forEach(model => {
            const isCurrent = model.id === currentModel;
            const item = document.createElement('div');
            item.className = 'llm-item' + (isCurrent ? ' active' : '');

            item.innerHTML = `
                <div class="llm-info">
                    <div class="llm-name">${model.name}</div>
                    <div class="llm-meta">${model.parameters || ''} · ${this.formatSize(model.size_mb)}</div>
                </div>
                <div class="llm-actions">
                    ${isCurrent
                        ? '<span class="llm-badge">Active</span>'
                        : `<button class="btn-secondary btn-small btn-load-llm" data-model-id="${model.id}">Load</button>`
                    }
                    <button class="btn-danger btn-small btn-delete-llm" data-model-id="${model.id}" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            `;

            // Add event listeners
            const loadBtn = item.querySelector('.btn-load-llm');
            if (loadBtn) {
                loadBtn.addEventListener('click', () => this.loadModel(model.id));
            }

            const deleteBtn = item.querySelector('.btn-delete-llm');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => this.deleteModel(model.id, model.name));
            }

            list.appendChild(item);
        });
    }

    renderAvailableModels(available, downloaded) {
        const list = document.getElementById('available-llm-list');
        const downloadedIds = downloaded.map(d => d.id);

        // Filter out already downloaded models
        const notDownloaded = available.filter(m => !downloadedIds.includes(m.id));

        if (notDownloaded.length === 0) {
            list.innerHTML = '<div class="llm-empty">All available models have been downloaded</div>';
            return;
        }

        list.innerHTML = '';

        notDownloaded.forEach(model => {
            const item = document.createElement('div');
            item.className = 'llm-item available';

            const bestForBadge = model.bestFor ? `<span class="llm-badge-best">${model.bestFor}</span>` : '';
            const tradeoffInfo = model.tradeoff ? `<span class="llm-tradeoff">⚡ ${model.tradeoff}</span>` : '';

            item.innerHTML = `
                <div class="llm-info">
                    <div class="llm-name-row">
                        <div class="llm-name">${model.name}</div>
                        ${bestForBadge}
                    </div>
                    <div class="llm-desc">${model.description || ''}</div>
                    <div class="llm-meta">${model.parameters || ''} · ${this.formatSize(model.size_mb)} ${tradeoffInfo}</div>
                </div>
                <div class="llm-actions">
                    <button class="btn-primary btn-small btn-download-llm" data-model-id="${model.id}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Download
                    </button>
                </div>
                <div class="llm-progress hidden" data-model-id="${model.id}">
                    <div class="progress-info">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: 0%"></div>
                        </div>
                        <span class="progress-text">0%</span>
                    </div>
                    <button class="btn-secondary btn-small btn-cancel-download" data-model-id="${model.id}">Cancel</button>
                </div>
            `;

            const downloadBtn = item.querySelector('.btn-download-llm');
            downloadBtn.addEventListener('click', () => this.downloadModel(model.id, item));

            const cancelBtn = item.querySelector('.btn-cancel-download');
            cancelBtn.addEventListener('click', () => this.cancelDownload(model.id, item));

            list.appendChild(item);
        });
    }

    async cancelDownload(modelId, itemElement) {
        try {
            const res = await fetch(`/llm/cancel-download/${modelId}`, {
                method: 'POST'
            });

            const data = await res.json();

            if (data.success || data.error === 'No download in progress') {
                this.clara.ui.showToast('Download cancelled');

                // Reset UI
                const downloadBtn = itemElement.querySelector('.btn-download-llm');
                const progressEl = itemElement.querySelector('.llm-progress');

                downloadBtn.classList.remove('hidden');
                progressEl.classList.add('hidden');
            } else {
                this.clara.ui.showToast(data.error || 'Failed to cancel download', true);
            }
        } catch (err) {
            this.clara.ui.showToast('Failed to cancel download: ' + err.message, true);
        }
    }

    formatSize(sizeMb) {
        if (!sizeMb) return '';
        if (sizeMb >= 1000) {
            return `${(sizeMb / 1000).toFixed(1)} GB`;
        }
        return `${sizeMb} MB`;
    }

    async loadModel(modelId) {
        this.clara.ui.showLoading('Loading model...');

        try {
            const res = await fetch('/llm/load', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            });

            const data = await res.json();

            if (data.error) {
                this.clara.ui.showToast(data.error, true);
            } else {
                this.clara.ui.showToast('Model loaded successfully');
                this.loadLLMStatus();
            }
        } catch (err) {
            this.clara.ui.showToast('Failed to load model: ' + err.message, true);
        }

        this.clara.ui.hideLoading();
    }

    async deleteModel(modelId, modelName) {
        if (!confirm(`Delete model "${modelName}"? This will free up disk space but you'll need to download it again to use it.`)) {
            return;
        }

        try {
            const res = await fetch(`/llm/delete/${modelId}`, {
                method: 'DELETE'
            });

            const data = await res.json();

            if (data.error) {
                this.clara.ui.showToast(data.error, true);
            } else {
                this.clara.ui.showToast('Model deleted');
                this.loadLLMStatus();
            }
        } catch (err) {
            this.clara.ui.showToast('Failed to delete model: ' + err.message, true);
        }
    }

    async downloadModel(modelId, itemElement) {
        const downloadBtn = itemElement.querySelector('.btn-download-llm');
        const progressEl = itemElement.querySelector('.llm-progress');
        const progressFill = progressEl.querySelector('.progress-fill');
        const progressText = progressEl.querySelector('.progress-text');

        // Show progress, hide button
        downloadBtn.classList.add('hidden');
        progressEl.classList.remove('hidden');

        try {
            const res = await fetch('/llm/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_id: modelId })
            });

            const data = await res.json();

            if (data.error) {
                this.clara.ui.showToast(data.error, true);
                downloadBtn.classList.remove('hidden');
                progressEl.classList.add('hidden');
                return;
            }

            // Poll for progress
            this.pollDownloadProgress(modelId, progressFill, progressText, downloadBtn, progressEl);

        } catch (err) {
            this.clara.ui.showToast('Download failed: ' + err.message, true);
            downloadBtn.classList.remove('hidden');
            progressEl.classList.add('hidden');
        }
    }

    async pollDownloadProgress(modelId, progressFill, progressText, downloadBtn, progressEl) {
        const checkProgress = async () => {
            try {
                const res = await fetch(`/llm/download-progress/${modelId}`);
                const data = await res.json();

                if (data.status === 'downloading') {
                    const percent = data.progress || 0;
                    progressFill.style.width = `${percent}%`;
                    progressText.textContent = `${Math.round(percent)}%`;
                    setTimeout(checkProgress, 1000);
                } else if (data.status === 'complete') {
                    progressFill.style.width = '100%';
                    progressText.textContent = 'Complete!';
                    this.clara.ui.showToast('Model downloaded successfully');
                    setTimeout(() => this.loadLLMStatus(), 1000);
                } else if (data.status === 'error') {
                    this.clara.ui.showToast(data.error || 'Download failed', true);
                    downloadBtn.classList.remove('hidden');
                    progressEl.classList.add('hidden');
                } else {
                    // Not started or unknown
                    setTimeout(checkProgress, 1000);
                }
            } catch (err) {
                setTimeout(checkProgress, 2000);
            }
        };

        checkProgress();
    }
}
