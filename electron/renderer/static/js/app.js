// Clara - Document Reader with Word-by-Word Highlighting
// Main Application Entry Point

import { createInitialState } from './modules/state.js';
import { NavigationManager } from './modules/navigation.js';
import { LibraryManager } from './modules/library.js';
import { ViewerManager } from './modules/viewer.js';
import { ReadingManager } from './modules/reading.js';
import { NotesManager } from './modules/notes.js';
import { ModalsManager } from './modules/modals.js';
import { ContextMenuManager } from './modules/context-menu.js';
import { DragDropManager } from './modules/drag-drop.js';
import { UIHelpers } from './modules/ui-helpers.js';
import { DictionaryManager } from './modules/dictionary.js';
import { VoiceSelectorManager } from './modules/voice-selector.js';
import { SettingsManager } from './modules/settings.js';
import { TOCManager } from './modules/toc.js';
import { PomodoroTimer } from './modules/pomodoro.js';
import { StudySessionManager } from './modules/study-session.js';

class Clara {
    constructor() {
        // Initialize state
        this.state = createInitialState();

        // Initialize all managers
        this.ui = new UIHelpers(this);
        this.navigation = new NavigationManager(this);
        this.library = new LibraryManager(this);
        this.viewer = new ViewerManager(this);
        this.reading = new ReadingManager(this);
        this.notes = new NotesManager(this);
        this.modals = new ModalsManager(this);
        this.contextMenu = new ContextMenuManager(this);
        this.dragDrop = new DragDropManager(this);
        this.dictionary = new DictionaryManager(this);
        this.voiceSelector = new VoiceSelectorManager(this);
        this.settings = new SettingsManager(this);
        this.toc = new TOCManager(this);
        this.pomodoro = new PomodoroTimer();
        this.studySession = new StudySessionManager(this);

        // Check for first launch before initializing
        this.checkFirstLaunch();
    }

    async checkFirstLaunch() {
        try {
            const res = await fetch('/first-launch-status');
            const data = await res.json();

            if (data.is_first_launch || !data.has_base_model) {
                this.showFirstLaunchSetup(data.base_model);
            } else {
                // Normal initialization
                this.init();
            }
        } catch (err) {
            console.error('[FirstLaunch] Check failed:', err);
            // Fallback to normal init
            this.init();
        }
    }

    async init() {
        // Setup all modules
        this.navigation.setup();
        this.library.setup();
        this.viewer.setup();
        this.viewer.setupZoom();
        this.reading.setup();
        this.notes.setup();
        this.modals.setup();
        this.contextMenu.setup();
        this.dragDrop.setup();
        this.dictionary.setup();
        this.voiceSelector.setup();
        this.settings.setup();
        this.toc.setup();
        this.studySession.setup();

        // Load saved voice preference
        await this.loadSavedVoice();

        // First-time onboarding
        await this.showOnboardingIfNeeded();

        // Load library on startup
        await this.library.load();
        this.navigation.updateTitle();
    }

    async loadSavedVoice() {
        const DEFAULT_EDGE_VOICE = 'en-US-JennyNeural';

        try {
            const res = await fetch('/tts/voice');
            const data = await res.json();
            const voiceId = data.voice_id || DEFAULT_EDGE_VOICE;

            if (!data.voice_id) {
                await fetch('/tts/voice', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ voice_id: DEFAULT_EDGE_VOICE })
                });
            }

            this.state.selectedVoice = voiceId;
            this.voiceSelector.currentVoiceId = voiceId;
        } catch (err) {
            console.log('Could not load saved voice:', err);
            this.state.selectedVoice = DEFAULT_EDGE_VOICE;
            this.voiceSelector.currentVoiceId = DEFAULT_EDGE_VOICE;
        }
    }

    async showOnboardingIfNeeded() {
        const ONBOARDING_KEY = 'onboarding_completed_v1';
        let completed = null;

        try {
            if (window.electronAPI?.prefs) {
                completed = await window.electronAPI.prefs.get(ONBOARDING_KEY);
            } else {
                completed = localStorage.getItem(ONBOARDING_KEY);
            }
        } catch (err) {
            completed = localStorage.getItem(ONBOARDING_KEY);
        }

        const onboardingCompleted =
            completed === true ||
            completed === 'true' ||
            completed === 1 ||
            completed === '1';

        if (onboardingCompleted) return;

        const modal = document.createElement('div');
        modal.id = 'onboarding-modal';
        modal.className = 'modal-backdrop';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(10,20,35,0.55);z-index:10001;display:flex;align-items:center;justify-content:center;padding:24px;';

        modal.innerHTML = `
            <div class="onboarding-card" style="width:min(760px,96vw);background:#ffffff;border-radius:18px;box-shadow:0 28px 60px rgba(24,37,58,0.22);overflow:hidden;">
                <div style="padding:22px 26px;border-bottom:1px solid #edf1f5;background:linear-gradient(180deg,#fbfcff,#f6f9fd);">
                    <h2 style="margin:0;font-size:22px;color:#1f2a3a;">Welcome to Clara</h2>
                    <p style="margin:8px 0 0;color:#5a6778;font-size:14px;">A calm reading companion for focused study.</p>
                </div>

                <div style="padding:22px 26px;">
                    <div class="onboarding-step" data-step="1">
                        <h3 style="margin:0 0 10px;font-size:16px;color:#1f2a3a;">1. Build your library</h3>
                        <p style="margin:0;color:#586678;line-height:1.6;">Upload PDFs, create folders, and drag items to organize. Delete moves items to Trash so you can restore later.</p>
                    </div>
                    <div class="onboarding-step hidden" data-step="2">
                        <h3 style="margin:0 0 10px;font-size:16px;color:#1f2a3a;">2. Read with audio + word tracking</h3>
                        <p style="margin:0;color:#586678;line-height:1.6;">Press <strong>Read This Page</strong>. Clara reads aloud with synchronized word highlighting on the page.</p>
                    </div>
                    <div class="onboarding-step hidden" data-step="3">
                        <h3 style="margin:0 0 10px;font-size:16px;color:#1f2a3a;">3. Understand faster</h3>
                        <p style="margin:0;color:#586678;line-height:1.6;">Click or double-click words for meanings, ask questions in context, and save notes while you read.</p>
                    </div>
                    <div class="onboarding-step hidden" data-step="4">
                        <h3 style="margin:0 0 10px;font-size:16px;color:#1f2a3a;">4. Keep it calm</h3>
                        <p style="margin:0;color:#586678;line-height:1.6;">Enable <strong>Calm focus mode</strong> in Settings → Reading for a low-distraction study flow.</p>
                    </div>

                    <div style="display:flex;gap:8px;margin-top:18px;" id="onboarding-dots">
                        <span style="width:8px;height:8px;border-radius:999px;background:#3b7cff;"></span>
                        <span style="width:8px;height:8px;border-radius:999px;background:#d6deea;"></span>
                        <span style="width:8px;height:8px;border-radius:999px;background:#d6deea;"></span>
                        <span style="width:8px;height:8px;border-radius:999px;background:#d6deea;"></span>
                    </div>
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 26px;border-top:1px solid #edf1f5;background:#fcfdff;">
                    <button id="onboarding-skip" style="border:none;background:transparent;color:#6a7688;font-weight:600;cursor:pointer;">Skip</button>
                    <div style="display:flex;gap:10px;">
                        <button id="onboarding-prev" style="border:1px solid #d8e0eb;background:#fff;color:#3f4d60;border-radius:10px;padding:8px 14px;cursor:pointer;" disabled>Back</button>
                        <button id="onboarding-next" style="border:none;background:#3b7cff;color:#fff;border-radius:10px;padding:8px 14px;font-weight:600;cursor:pointer;">Next</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        let step = 1;
        const totalSteps = 4;

        const renderStep = () => {
            modal.querySelectorAll('.onboarding-step').forEach(el => {
                const elStep = parseInt(el.dataset.step);
                el.classList.toggle('hidden', elStep !== step);
            });

            const dots = modal.querySelectorAll('#onboarding-dots span');
            dots.forEach((dot, idx) => {
                dot.style.background = idx + 1 === step ? '#3b7cff' : '#d6deea';
            });

            const prevBtn = modal.querySelector('#onboarding-prev');
            const nextBtn = modal.querySelector('#onboarding-next');
            prevBtn.disabled = step === 1;
            nextBtn.textContent = step === totalSteps ? 'Get Started' : 'Next';
        };

        const complete = async () => {
            try {
                if (window.electronAPI?.prefs) {
                    await window.electronAPI.prefs.set(ONBOARDING_KEY, true);
                }
                localStorage.setItem(ONBOARDING_KEY, 'true');
            } catch (err) {
                localStorage.setItem(ONBOARDING_KEY, 'true');
            }
            modal.remove();
        };

        modal.querySelector('#onboarding-skip').addEventListener('click', complete);
        modal.querySelector('#onboarding-prev').addEventListener('click', () => {
            step = Math.max(1, step - 1);
            renderStep();
        });
        modal.querySelector('#onboarding-next').addEventListener('click', async () => {
            if (step >= totalSteps) {
                await complete();
                return;
            }
            step += 1;
            renderStep();
        });

        renderStep();
    }

    showFirstLaunchSetup(baseModel) {
        console.log('[FirstLaunch] Showing setup screen');

        // Create first-launch modal
        const modal = document.createElement('div');
        modal.id = 'first-launch-modal';
        modal.className = 'modal-backdrop';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 10000; display: flex; align-items: center; justify-content: center;';

        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px; background: white; border-radius: 8px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                <div class="first-launch-header" style="text-align: center; margin-bottom: 24px;">
                    <h1 style="margin: 0 0 8px 0; font-size: 28px; color: #333;">Welcome to Clara</h1>
                    <p style="margin: 0; color: #666; font-size: 16px;">Your intelligent reading companion</p>
                </div>

                <div class="first-launch-body">
                    <div class="setup-status" style="text-align: center; margin: 24px 0;">
                        <div class="spinner" style="border: 3px solid #f3f3f3; border-top: 3px solid #4A90E2; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
                        <p class="setup-message" style="color: #666; font-size: 14px;">Preparing Clara for first use...</p>
                    </div>

                    <div class="setup-progress" style="margin: 24px 0;">
                        <div class="progress-bar" style="background: #e0e0e0; height: 8px; border-radius: 4px; overflow: hidden;">
                            <div class="progress-fill" id="setup-progress-fill" style="background: #4A90E2; height: 100%; width: 0%; transition: width 0.3s;"></div>
                        </div>
                        <div class="progress-text" id="setup-progress-text" style="text-align: center; margin-top: 8px; font-size: 14px; color: #666;">0%</div>
                    </div>

                    <div class="setup-details" style="margin: 24px 0;">
                        <h3 style="font-size: 16px; color: #333; margin: 0 0 12px 0;">Setting up AI capabilities</h3>
                        <ul style="list-style: none; padding: 0; margin: 0;">
                            <li style="padding: 8px 0; color: #666; font-size: 14px;">
                                <span style="color: #4CAF50;">✓</span> Document library ready
                            </li>
                            <li id="model-status" style="padding: 8px 0; color: #666; font-size: 14px;">
                                <span style="color: #FFA726;">⏳</span> Downloading AI model (${baseModel.size_mb} MB)...
                            </li>
                            <li id="feature-status" style="padding: 8px 0; color: #666; font-size: 14px;">
                                <span style="color: #FFA726;">⏳</span> Enabling intelligent features...
                            </li>
                        </ul>
                    </div>

                    <div class="setup-info" style="background: #f5f5f5; padding: 16px; border-radius: 4px; margin-top: 24px;">
                        <p style="margin: 0 0 8px 0; font-weight: 600; font-size: 14px; color: #333;">This one-time setup enables:</p>
                        <ul style="margin: 8px 0 0 20px; padding: 0; font-size: 14px; color: #666;">
                            <li>Ask questions about your documents</li>
                            <li>Smart table of contents extraction</li>
                            <li>Intelligent text processing</li>
                            <li>Context-aware reading features</li>
                        </ul>
                    </div>
                </div>

                <div class="first-launch-footer" style="margin-top: 24px; text-align: center;">
                    <button id="btn-skip-setup" class="btn-secondary" style="background: #e0e0e0; color: #666; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;">
                        Skip AI features (not recommended)
                    </button>
                </div>
            </div>

            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;

        document.body.appendChild(modal);

        // Start base model download
        this.downloadBaseModel(baseModel.id);

        // Handle skip button
        document.getElementById('btn-skip-setup').addEventListener('click', () => {
            if (confirm('Clara works best with AI features enabled. Skip setup anyway?')) {
                modal.remove();
                this.init();
            }
        });
    }

    async downloadBaseModel(modelId) {
        console.log('[FirstLaunch] Starting base model download:', modelId);

        try {
            // Trigger download
            const res = await fetch(`/llm/download/${modelId}`, {
                method: 'POST'
            });

            const data = await res.json();

            if (!res.ok || data.error) {
                throw new Error(data.error || 'Download failed');
            }

            // Poll for progress
            this.pollBaseModelDownload(modelId);

        } catch (err) {
            console.error('[FirstLaunch] Download failed:', err);
            this.showSetupError(err);
        }
    }

    async pollBaseModelDownload(modelId) {
        const progressFill = document.getElementById('setup-progress-fill');
        const progressText = document.getElementById('setup-progress-text');
        const modelStatus = document.getElementById('model-status');

        const checkProgress = async () => {
            try {
                const res = await fetch(`/llm/download/${modelId}/progress`);
                const data = await res.json();

                if (data.in_progress) {
                    const percent = data.percent || 0;
                    progressFill.style.width = `${percent}%`;
                    progressText.textContent = `${Math.round(percent)}%`;

                    if (data.downloaded_mb && data.total_mb) {
                        modelStatus.innerHTML = `<span style="color: #FFA726;">⏳</span> Downloading AI model (${data.downloaded_mb} / ${data.total_mb} MB)...`;
                    } else {
                        modelStatus.innerHTML = `<span style="color: #FFA726;">⏳</span> Downloading AI model (${Math.round(percent)}%)...`;
                    }

                    setTimeout(checkProgress, 1000);

                } else if (data.complete) {
                    progressFill.style.width = '100%';
                    progressText.textContent = '100%';
                    modelStatus.innerHTML = '<span style="color: #4CAF50;">✓</span> AI model ready';

                    // Load the model
                    await this.loadBaseModel(modelId);

                } else if (data.error) {
                    this.showSetupError(new Error(data.error || 'Download failed'));

                } else {
                    setTimeout(checkProgress, 1000);
                }
            } catch (err) {
                console.error('[FirstLaunch] Progress check failed:', err);
                setTimeout(checkProgress, 2000);
            }
        };

        checkProgress();
    }

    async loadBaseModel(modelId) {
        const featureStatus = document.getElementById('feature-status');
        featureStatus.innerHTML = '<span style="color: #FFA726;">⏳</span> Loading AI model...';

        try {
            const res = await fetch(`/llm/switch/${modelId}`, {
                method: 'POST'
            });

            const data = await res.json();

            if (data.error) {
                throw new Error(data.error);
            }

            featureStatus.innerHTML = '<span style="color: #4CAF50;">✓</span> All features enabled!';

            // Mark first launch as complete
            await fetch('/mark-first-launch-complete', { method: 'POST' });

            console.log('[FirstLaunch] Setup complete!');

            // Wait a moment, then close setup and start Clara
            setTimeout(() => {
                const modal = document.getElementById('first-launch-modal');
                if (modal) modal.remove();
                this.init();
            }, 1500);

        } catch (err) {
            console.error('[FirstLaunch] Model load failed:', err);
            this.showSetupError(err);
        }
    }

    showSetupError(err) {
        const modal = document.getElementById('first-launch-modal');
        if (!modal) return;

        const body = modal.querySelector('.first-launch-body');

        body.innerHTML = `
            <div class="setup-error" style="text-align: center; padding: 24px 0;">
                <h3 style="color: #f44336; margin: 0 0 16px 0;">Setup Error</h3>
                <p style="color: #666; margin: 0 0 8px 0;">Failed to download AI model: ${err.message}</p>
                <p style="color: #666; margin: 0 0 24px 0;">You can still use Clara, but some features won't work.</p>

                <div class="error-actions">
                    <button id="btn-retry-setup" class="btn-primary" style="background: #4A90E2; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin: 0 8px; font-size: 14px;">
                        Retry Setup
                    </button>
                    <button id="btn-continue-without" class="btn-secondary" style="background: #e0e0e0; color: #666; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin: 0 8px; font-size: 14px;">
                        Continue Without AI
                    </button>
                </div>
            </div>
        `;

        document.getElementById('btn-retry-setup').addEventListener('click', () => {
            modal.remove();
            this.checkFirstLaunch();
        });

        document.getElementById('btn-continue-without').addEventListener('click', () => {
            modal.remove();
            this.init();
        });
    }
}

// Initialize when ready
document.addEventListener('DOMContentLoaded', () => {
    window.clara = new Clara();
});
