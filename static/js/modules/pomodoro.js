/**
 * Psychologically Optimized Pomodoro Timer
 *
 * Features designed to maximize completion satisfaction:
 * - Visual progress triggers dopamine
 * - Milestone celebrations create mini-wins
 * - Urgency triggers at 75% and 90%
 * - Confetti celebration on completion
 * - Streak tracking for sustained motivation
 * - Achievement system
 */

export class PomodoroTimer {
    constructor() {
        this.totalSeconds = 25 * 60; // Default 25 minutes
        this.remainingSeconds = this.totalSeconds;
        this.isRunning = false;
        this.isPaused = false;
        this.intervalId = null;

        // Track milestones to avoid duplicate triggers
        this.milestones = {
            milestone75: false,
            milestone90: false,
            lastMinute: false
        };

        this.initElements();
        this.attachEventListeners();
        this.updateDisplay();
        this.loadStats();
    }

    initElements() {
        // Main button and display
        this.btn = document.getElementById('btn-pomodoro');
        this.timeDisplay = document.getElementById('pomodoro-time');
        this.dropdown = document.getElementById('pomodoro-dropdown');

        // Pac-Man SVG elements
        this.pacmanBody = this.btn.querySelector('.pacman-body');
        this.pacmanMouth = this.btn.querySelector('.pacman-mouth');

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

        // Time inputs - update on change and Enter key
        this.minutesInput.addEventListener('change', () => this.updateTimeFromInputs());
        this.secondsInput.addEventListener('change', () => this.updateTimeFromInputs());

        this.minutesInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.updateTimeFromInputs();
                this.minutesInput.blur();
            }
        });

        this.secondsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.updateTimeFromInputs();
                this.secondsInput.blur();
            }
        });

        // Select all text when focused for easy editing
        this.minutesInput.addEventListener('focus', () => this.minutesInput.select());
        this.secondsInput.addEventListener('focus', () => this.secondsInput.select());

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

        // Validate total time is not zero
        if (minutes === 0 && seconds === 0) {
            this.minutesInput.value = '01';
            this.secondsInput.value = '00';
            this.setTime(1, 0);
            return;
        }

        this.setTime(minutes, seconds);
    }

    setTime(minutes, seconds) {
        if (this.isRunning && !this.isPaused) {
            return; // Don't change time while running
        }

        // Clamp values to reasonable ranges
        minutes = Math.min(99, Math.max(0, minutes));
        seconds = Math.min(59, Math.max(0, seconds));

        this.totalSeconds = minutes * 60 + seconds;
        this.remainingSeconds = this.totalSeconds;

        this.minutesInput.value = minutes.toString().padStart(2, '0');
        this.secondsInput.value = seconds.toString().padStart(2, '0');

        this.updateDisplay();
        this.updatePieChart();

        // Reset milestones
        this.resetMilestones();

        // Provide visual feedback for custom time
        if (minutes !== 25 || seconds !== 0) {
            this.btn.style.animation = 'gentle-bounce 0.3s ease-out';
            setTimeout(() => {
                this.btn.style.animation = '';
            }, 300);
        }
    }

    resetMilestones() {
        this.milestones = {
            milestone75: false,
            milestone90: false,
            lastMinute: false
        };
    }

    start() {
        if (this.totalSeconds === 0) {
            return;
        }

        this.isRunning = true;
        this.isPaused = false;

        this.btn.classList.add('running');
        this.btn.classList.remove('paused', 'completed', 'almost-complete', 'final-push');

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

        this.btn.classList.remove('running', 'almost-complete', 'final-push');
        this.btn.classList.add('paused');

        this.pauseBtn.classList.add('hidden');
        this.startBtn.classList.remove('hidden');

        clearInterval(this.intervalId);
    }

    stop() {
        this.isRunning = false;
        this.isPaused = false;

        this.btn.classList.remove('running', 'paused', 'completed', 'almost-complete', 'final-push');

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
        this.resetMilestones();
    }

    tick() {
        if (this.remainingSeconds > 0) {
            this.remainingSeconds--;
            this.updateDisplay();
            this.updatePieChart();
            this.checkPsychologicalTriggers();
        } else {
            this.complete();
        }
    }

    checkPsychologicalTriggers() {
        const progress = ((this.totalSeconds - this.remainingSeconds) / this.totalSeconds) * 100;

        // Clear previous urgency states
        this.btn.classList.remove('almost-complete', 'final-push');

        // TRIGGER 1: 75% milestone - "You're doing great! Keep going!"
        if (progress >= 75 && progress < 90) {
            this.btn.classList.add('almost-complete');

            if (!this.milestones.milestone75) {
                this.milestones.milestone75 = true;
                this.showEncouragement("You're 75% done! Keep going! 🔥", 'milestone');
                this.playSound('milestone');
            }
        }

        // TRIGGER 2: 90% milestone - "Final push! You're SO close!"
        if (progress >= 90) {
            this.btn.classList.add('final-push');

            if (!this.milestones.milestone90) {
                this.milestones.milestone90 = true;
                this.showEncouragement("Final stretch! Don't stop now! 💪", 'urgency');
                this.playSound('urgency');
            }
        }

        // TRIGGER 3: Last minute - "One minute left!"
        if (this.remainingSeconds === 60 && !this.milestones.lastMinute) {
            this.milestones.lastMinute = true;
            this.showEncouragement("One minute left! You got this! ⚡", 'final');
        }
    }

    complete() {
        this.isRunning = false;
        this.isPaused = false;

        clearInterval(this.intervalId);

        // DOPAMINE EXPLOSION!
        this.btn.classList.remove('running', 'paused', 'almost-complete', 'final-push');
        this.btn.classList.add('completed');

        // Show "DONE!" text
        this.timeDisplay.textContent = 'DONE!';

        // Re-enable inputs
        this.minutesInput.disabled = false;
        this.secondsInput.disabled = false;

        // CELEBRATION SEQUENCE
        this.celebrateCompletion();

        // Play triumphant sound
        this.playSound('complete');

        // Show completion message
        this.showEncouragement('🎉 Pomodoro Complete! Amazing work!', 'complete');

        // Track completion for streaks
        this.trackCompletion();

        // Show browser notification
        this.showNotification();

        // Reset after celebration
        setTimeout(() => {
            this.btn.classList.remove('completed');
            this.startBtn.classList.remove('hidden');
            this.pauseBtn.classList.add('hidden');
            this.stopBtn.classList.add('hidden');
            this.remainingSeconds = this.totalSeconds;
            this.updateDisplay();
            this.updatePieChart();
            this.resetMilestones();
        }, 3000);
    }

    celebrateCompletion() {
        // Confetti burst!
        for (let i = 0; i < 50; i++) {
            setTimeout(() => this.createConfetti(), i * 30);
        }
    }

    createConfetti() {
        const confetti = document.createElement('div');
        const colors = ['#FF3B30', '#34C759', '#FFD60A', '#5E5CE6', '#FF9500', '#FF2D55'];
        const color = colors[Math.floor(Math.random() * colors.length)];

        confetti.style.cssText = `
            position: fixed;
            width: ${8 + Math.random() * 6}px;
            height: ${8 + Math.random() * 6}px;
            background: ${color};
            left: ${Math.random() * 100}%;
            top: -20px;
            border-radius: 50%;
            pointer-events: none;
            z-index: 10000;
            animation: confetti-fall ${2 + Math.random() * 2}s linear forwards;
        `;

        document.body.appendChild(confetti);
        setTimeout(() => confetti.remove(), 4000);
    }

    showEncouragement(message, type = 'milestone') {
        const toast = document.createElement('div');
        toast.className = `timer-encouragement timer-encouragement-${type}`;
        toast.textContent = message;

        document.body.appendChild(toast);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    playSound(type) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            // Different sounds for different events
            const sounds = {
                'milestone': { freq: 600, duration: 0.15 },
                'urgency': { freq: 700, duration: 0.1 },
                'complete': { freq: 800, duration: 0.5 }
            };

            const sound = sounds[type] || sounds.milestone;

            oscillator.frequency.value = sound.freq;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + sound.duration);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + sound.duration);

            // For complete sound, play a triumphant chord
            if (type === 'complete') {
                [1000, 1200].forEach((freq, i) => {
                    setTimeout(() => {
                        const osc2 = audioContext.createOscillator();
                        const gain2 = audioContext.createGain();
                        osc2.connect(gain2);
                        gain2.connect(audioContext.destination);
                        osc2.frequency.value = freq;
                        osc2.type = 'sine';
                        gain2.gain.setValueAtTime(0.1, audioContext.currentTime);
                        gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
                        osc2.start(audioContext.currentTime);
                        osc2.stop(audioContext.currentTime + 0.3);
                    }, i * 100);
                });
            }
        } catch (error) {
            console.log('[Pomodoro] Could not play sound:', error);
        }
    }

    showNotification() {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('🎉 Study Timer Complete!', {
                body: 'Great work! Time for a well-deserved break.',
                icon: '/static/favicon.ico',
                tag: 'pomodoro-complete'
            });
        } else if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }

    trackCompletion() {
        const completions = JSON.parse(localStorage.getItem('pomodoro_completions') || '[]');
        completions.push(Date.now());
        localStorage.setItem('pomodoro_completions', JSON.stringify(completions));

        // Update stats
        this.loadStats();

        // Check for streak achievement
        const streak = this.calculateStreak(completions);
        if (streak > 1) {
            setTimeout(() => {
                this.showEncouragement(`🔥 ${streak} day streak! Keep it up!`, 'complete');
            }, 2000);
        }

        // Check for milestones
        const total = completions.length;
        const achievements = [
            { count: 1, message: '🎯 First Pomodoro! The journey begins!', name: 'first' },
            { count: 5, message: '🌱 5 Pomodoros! Building the habit!', name: 'five' },
            { count: 10, message: '⭐ 10 Pomodoros! You\'re on fire!', name: 'ten' },
            { count: 25, message: '🏆 25 Pomodoros! Productivity master!', name: 'master' },
            { count: 50, message: '👑 50 Pomodoros! Unstoppable!', name: 'unstoppable' }
        ];

        const achievement = achievements.find(a => a.count === total);
        if (achievement) {
            const unlocked = JSON.parse(localStorage.getItem('pomodoro_achievements') || '[]');
            if (!unlocked.includes(achievement.name)) {
                unlocked.push(achievement.name);
                localStorage.setItem('pomodoro_achievements', JSON.stringify(unlocked));

                setTimeout(() => {
                    this.showEncouragement(achievement.message, 'complete');
                }, 3500);
            }
        }
    }

    calculateStreak(completions) {
        if (completions.length === 0) return 0;

        // Get unique days
        const days = completions.map(t => {
            const date = new Date(t);
            return Math.floor(date.getTime() / (1000 * 60 * 60 * 24));
        });

        const uniqueDays = [...new Set(days)].sort((a, b) => b - a);

        // Count consecutive days
        let streak = 0;
        const today = Math.floor(Date.now() / (1000 * 60 * 60 * 24));

        for (let i = 0; i < uniqueDays.length; i++) {
            const expectedDay = today - i;
            if (uniqueDays[i] === expectedDay) {
                streak++;
            } else {
                break;
            }
        }

        return streak;
    }

    loadStats() {
        const completions = JSON.parse(localStorage.getItem('pomodoro_completions') || '[]');

        // Count today's pomodoros
        const today = new Date().setHours(0, 0, 0, 0);
        const todayCount = completions.filter(t => t >= today).length;

        // Calculate streak
        const streak = this.calculateStreak(completions);

        // Update header if exists
        const header = this.dropdown.querySelector('.pomodoro-header');
        if (header && (todayCount > 0 || streak > 0)) {
            let statsHTML = '<h3>Study Timer</h3>';
            if (todayCount > 0) {
                statsHTML += `<div class="pomodoro-stat">Today: <strong>${todayCount}</strong> 🎯</div>`;
            }
            if (streak > 1) {
                statsHTML += `<div class="pomodoro-stat">Streak: <strong>${streak}</strong> days 🔥</div>`;
            }
            header.innerHTML = statsHTML;
        }
    }

    updateDisplay() {
        if (this.remainingSeconds === 0 && this.btn.classList.contains('completed')) {
            this.timeDisplay.textContent = 'DONE!';
            return;
        }

        const minutes = Math.floor(this.remainingSeconds / 60);
        const seconds = this.remainingSeconds % 60;

        const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        this.timeDisplay.textContent = timeString;
    }

    updatePieChart() {
        // Calculate progress percentage (0 = start, 100 = complete)
        const progress = ((this.totalSeconds - this.remainingSeconds) / this.totalSeconds) * 100;

        // Rotate Pac-Man around the circle (360 degrees = full circle)
        // Start at top (0°) and rotate clockwise
        const rotationDegrees = (progress / 100) * 360;
        this.pacmanBody.style.transform = `rotate(${rotationDegrees}deg)`;

        // Update Pac-Man color based on progress
        const circle = this.pacmanBody.querySelector('circle');

        if (this.btn.classList.contains('completed')) {
            circle.setAttribute('fill', '#34C759'); // Green - completed!
        } else if (progress >= 90) {
            circle.setAttribute('fill', '#FF3B30'); // Urgent red - final push!
        } else if (progress >= 75) {
            circle.setAttribute('fill', '#FF6B00'); // Orange - almost there!
        } else {
            circle.setAttribute('fill', '#FF3B30'); // Red - working
        }

        // Make mouth wider as time runs out (more urgency)
        if (this.isRunning) {
            let mouthAngle = 15; // Default mouth angle

            if (progress >= 90) {
                mouthAngle = 25; // Wider mouth for urgency!
            } else if (progress >= 75) {
                mouthAngle = 20; // Getting wider
            }

            // Update mouth path for wider/narrower opening
            const mouthPath = `M 20 20 L 35 ${15 + mouthAngle/2} A 18 18 0 0 1 35 ${25 - mouthAngle/2} Z`;
            this.pacmanMouth.setAttribute('d', mouthPath);
        }
    }

    // Public methods
    isActive() {
        return this.isRunning || this.isPaused;
    }

    getTimeRemaining() {
        return {
            minutes: Math.floor(this.remainingSeconds / 60),
            seconds: this.remainingSeconds % 60,
            total: this.remainingSeconds
        };
    }
}
