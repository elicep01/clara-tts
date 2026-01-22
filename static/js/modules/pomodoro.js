/**
 * Pomodoro Timer Module
 *
 * Features:
 * - Visual pie chart countdown animation
 * - Start, pause, stop controls
 * - Custom time setting (minutes:seconds)
 * - Quick preset buttons (15, 25, 45, 60 minutes)
 * - Audio notification on completion
 */

export class PomodoroTimer {
    constructor() {
        this.totalSeconds = 25 * 60; // Default 25 minutes
        this.remainingSeconds = this.totalSeconds;
        this.isRunning = false;
        this.isPaused = false;
        this.intervalId = null;

        this.initElements();
        this.attachEventListeners();
        this.updateDisplay();
    }

    initElements() {
        // Main button and display
        this.btn = document.getElementById('btn-pomodoro');
        this.timeDisplay = document.getElementById('pomodoro-time');
        this.dropdown = document.getElementById('pomodoro-dropdown');

        // Pie chart SVG elements
        this.pieCircle = this.btn.querySelector('.pomodoro-fill');

        // Input controls
        this.minutesInput = document.getElementById('minutes-input');
        this.secondsInput = document.getElementById('seconds-input');

        // Control buttons
        this.startBtn = document.getElementById('pomodoro-start');
        this.pauseBtn = document.getElementById('pomodoro-pause');
        this.stopBtn = document.getElementById('pomodoro-stop');

        // Preset buttons
        this.presetBtns = document.querySelectorAll('.preset-btn');
    }

    attachEventListeners() {
        // Toggle dropdown
        this.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.dropdown.contains(e.target) && e.target !== this.btn) {
                this.closeDropdown();
            }
        });

        // Control buttons
        this.startBtn.addEventListener('click', () => this.start());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.stopBtn.addEventListener('click', () => this.stop());

        // Time inputs
        this.minutesInput.addEventListener('change', () => this.updateTimeFromInputs());
        this.secondsInput.addEventListener('change', () => this.updateTimeFromInputs());

        // Prevent dropdown close on input
        this.dropdown.addEventListener('click', (e) => e.stopPropagation());

        // Preset buttons
        this.presetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const minutes = parseInt(btn.dataset.minutes);
                this.setTime(minutes, 0);
            });
        });

        // Format inputs on blur
        this.minutesInput.addEventListener('blur', () => this.formatInput(this.minutesInput));
        this.secondsInput.addEventListener('blur', () => this.formatInput(this.secondsInput));
    }

    toggleDropdown() {
        this.dropdown.classList.toggle('hidden');
    }

    closeDropdown() {
        this.dropdown.classList.add('hidden');
    }

    formatInput(input) {
        let value = parseInt(input.value) || 0;

        if (input === this.secondsInput) {
            value = Math.min(59, Math.max(0, value));
        } else {
            value = Math.max(0, value);
        }

        input.value = value.toString().padStart(2, '0');
    }

    updateTimeFromInputs() {
        const minutes = parseInt(this.minutesInput.value) || 0;
        const seconds = parseInt(this.secondsInput.value) || 0;
        this.setTime(minutes, seconds);
    }

    setTime(minutes, seconds) {
        if (this.isRunning && !this.isPaused) {
            return; // Don't change time while running
        }

        this.totalSeconds = minutes * 60 + seconds;
        this.remainingSeconds = this.totalSeconds;

        this.minutesInput.value = minutes.toString().padStart(2, '0');
        this.secondsInput.value = seconds.toString().padStart(2, '0');

        this.updateDisplay();
        this.updatePieChart();
    }

    start() {
        if (this.totalSeconds === 0) {
            return;
        }

        this.isRunning = true;
        this.isPaused = false;

        this.btn.classList.add('running');
        this.btn.classList.remove('paused', 'completed');

        this.startBtn.classList.add('hidden');
        this.pauseBtn.classList.remove('hidden');
        this.stopBtn.classList.remove('hidden');

        // Disable inputs while running
        this.minutesInput.disabled = true;
        this.secondsInput.disabled = true;

        this.intervalId = setInterval(() => this.tick(), 1000);
    }

    pause() {
        this.isPaused = true;
        this.isRunning = false;

        this.btn.classList.remove('running');
        this.btn.classList.add('paused');

        this.pauseBtn.classList.add('hidden');
        this.startBtn.classList.remove('hidden');

        clearInterval(this.intervalId);
    }

    stop() {
        this.isRunning = false;
        this.isPaused = false;

        this.btn.classList.remove('running', 'paused', 'completed');

        this.startBtn.classList.remove('hidden');
        this.pauseBtn.classList.add('hidden');
        this.stopBtn.classList.add('hidden');

        // Re-enable inputs
        this.minutesInput.disabled = false;
        this.secondsInput.disabled = false;

        clearInterval(this.intervalId);

        // Reset to original time
        this.remainingSeconds = this.totalSeconds;
        this.updateDisplay();
        this.updatePieChart();
    }

    tick() {
        if (this.remainingSeconds > 0) {
            this.remainingSeconds--;
            this.updateDisplay();
            this.updatePieChart();
        } else {
            this.complete();
        }
    }

    complete() {
        this.isRunning = false;
        this.isPaused = false;

        clearInterval(this.intervalId);

        this.btn.classList.remove('running', 'paused');
        this.btn.classList.add('completed');

        this.startBtn.classList.remove('hidden');
        this.pauseBtn.classList.add('hidden');
        this.stopBtn.classList.add('hidden');

        // Re-enable inputs
        this.minutesInput.disabled = false;
        this.secondsInput.disabled = false;

        // Play completion sound (browser beep)
        this.playCompletionSound();

        // Show notification
        this.showNotification();

        // Reset after animation
        setTimeout(() => {
            this.btn.classList.remove('completed');
            this.remainingSeconds = this.totalSeconds;
            this.updateDisplay();
            this.updatePieChart();
        }, 2000);
    }

    playCompletionSound() {
        // Create audio context for beep sound
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (error) {
            console.log('[Pomodoro] Could not play sound:', error);
        }
    }

    showNotification() {
        // Show browser notification if permitted
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Study Timer Complete!', {
                body: 'Great work! Time for a break.',
                icon: '/static/favicon.ico'
            });
        } else if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }

    updateDisplay() {
        const minutes = Math.floor(this.remainingSeconds / 60);
        const seconds = this.remainingSeconds % 60;

        const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        this.timeDisplay.textContent = timeString;
    }

    updatePieChart() {
        // Calculate progress percentage (100 = empty, 0 = full)
        const percentage = (this.remainingSeconds / this.totalSeconds) * 100;

        // Update stroke-dashoffset to animate the pie chart
        // The circumference is 100 (set in stroke-dasharray)
        this.pieCircle.style.strokeDashoffset = percentage;
    }

    // Public method to check if timer is active
    isActive() {
        return this.isRunning || this.isPaused;
    }

    // Public method to get remaining time
    getTimeRemaining() {
        return {
            minutes: Math.floor(this.remainingSeconds / 60),
            seconds: this.remainingSeconds % 60,
            total: this.remainingSeconds
        };
    }
}
