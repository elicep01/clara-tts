// Clara - Study Session Module
// Handles collaborative reading with real-time sync

export class StudySessionManager {
    constructor(clara) {
        this.clara = clara;
        this.state = clara.state;
        this.socket = null;
        this.sessionCode = null;
        this.isHost = false;
        this.userName = '';
        this.participants = [];
        this.chatHistory = [];
        this.syncReading = true;  // Follow the reader
    }

    setup() {
        // Study session button in toolbar
        const studyBtn = document.getElementById('btn-study-session');
        if (studyBtn) {
            studyBtn.addEventListener('click', () => this.showStudyModal());
        }

        // Modal close buttons
        document.getElementById('btn-close-study-modal')?.addEventListener('click', () => {
            this.hideStudyModal();
        });

        document.querySelector('#study-modal .modal-backdrop')?.addEventListener('click', () => {
            this.hideStudyModal();
        });

        // Create session button
        document.getElementById('btn-create-session')?.addEventListener('click', () => {
            this.showCreateForm();
        });

        // Join session button
        document.getElementById('btn-join-session')?.addEventListener('click', () => {
            this.showJoinForm();
        });

        // Back buttons
        document.getElementById('btn-back-to-study-menu')?.addEventListener('click', () => {
            this.showStudyMenu();
        });

        document.getElementById('btn-back-to-study-menu-join')?.addEventListener('click', () => {
            this.showStudyMenu();
        });

        // Form submissions
        document.getElementById('btn-start-session')?.addEventListener('click', () => {
            this.createSession();
        });

        document.getElementById('btn-connect-session')?.addEventListener('click', () => {
            this.joinSession();
        });

        // Leave session button
        document.getElementById('btn-leave-study')?.addEventListener('click', () => {
            this.leaveSession();
        });

        // Chat input
        const chatInput = document.getElementById('study-chat-input');
        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChatMessage();
                }
            });
        }

        document.getElementById('btn-send-chat')?.addEventListener('click', () => {
            this.sendChatMessage();
        });

        // Sync toggle
        document.getElementById('study-sync-toggle')?.addEventListener('change', (e) => {
            this.syncReading = e.target.checked;
        });
    }

    showStudyModal() {
        document.getElementById('study-modal').classList.remove('hidden');
        this.showStudyMenu();
    }

    hideStudyModal() {
        document.getElementById('study-modal').classList.add('hidden');
    }

    showStudyMenu() {
        document.getElementById('study-menu').classList.remove('hidden');
        document.getElementById('study-create-form').classList.add('hidden');
        document.getElementById('study-join-form').classList.add('hidden');
        document.getElementById('study-active-session').classList.add('hidden');
    }

    showCreateForm() {
        document.getElementById('study-menu').classList.add('hidden');
        document.getElementById('study-create-form').classList.remove('hidden');

        // Pre-fill document name if one is open
        if (this.state.viewerDocName) {
            document.getElementById('create-doc-name').value = this.state.viewerDocName;
        }
    }

    showJoinForm() {
        document.getElementById('study-menu').classList.add('hidden');
        document.getElementById('study-join-form').classList.remove('hidden');
        document.getElementById('join-session-code').value = '';
        document.getElementById('join-session-code').focus();
    }

    showActiveSession() {
        document.getElementById('study-menu').classList.add('hidden');
        document.getElementById('study-create-form').classList.add('hidden');
        document.getElementById('study-join-form').classList.add('hidden');
        document.getElementById('study-active-session').classList.remove('hidden');

        // Update session info
        document.getElementById('session-code-display').textContent = this.sessionCode;
        document.getElementById('session-doc-name').textContent = this.state.studyDocName || 'Document';
        this.updateParticipantsList();
    }

    async createSession() {
        const hostName = document.getElementById('create-host-name').value.trim() || 'Host';
        const docName = document.getElementById('create-doc-name').value.trim() || 'Untitled';

        // Check if a document is open
        if (!this.state.viewerDocId) {
            this.clara.ui.showToast('Please open a document first', true);
            return;
        }

        this.clara.ui.showLoading('Creating study session...');

        try {
            // Get the current document file
            const docPath = this.state.viewerDocPath;

            // Fetch the document and upload it
            const docResponse = await fetch(`/document/${this.state.viewerDocId}/file`);
            if (!docResponse.ok) {
                throw new Error('Failed to get document');
            }

            const docBlob = await docResponse.blob();
            const formData = new FormData();
            formData.append('document', docBlob, this.state.viewerDocName || 'document.pdf');
            formData.append('doc_name', docName);
            formData.append('host_name', hostName);

            const res = await fetch('/study/create', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();

            if (data.error) {
                throw new Error(data.error);
            }

            this.sessionCode = data.code;
            this.isHost = true;
            this.userName = hostName;
            this.state.studyDocName = docName;

            // Connect to socket
            await this.connectSocket();

            this.clara.ui.hideLoading();
            this.showActiveSession();
            this.clara.ui.showToast(`Session created! Code: ${this.sessionCode}`);

        } catch (err) {
            this.clara.ui.hideLoading();
            this.clara.ui.showToast('Failed to create session: ' + err.message, true);
        }
    }

    async joinSession() {
        const code = document.getElementById('join-session-code').value.trim().toUpperCase();
        const userName = document.getElementById('join-user-name').value.trim() || 'Guest';

        if (!code || code.length !== 6) {
            this.clara.ui.showToast('Please enter a valid 6-character code', true);
            return;
        }

        this.clara.ui.showLoading('Joining session...');

        try {
            // Check if session exists
            const res = await fetch(`/study/join/${code}`);
            const data = await res.json();

            if (data.error) {
                throw new Error(data.error);
            }

            this.sessionCode = code;
            this.isHost = false;
            this.userName = userName;
            this.state.studyDocName = data.doc_name;

            // Connect to socket
            await this.connectSocket();

            // Load the shared document
            await this.loadStudyDocument();

            this.clara.ui.hideLoading();
            this.showActiveSession();
            this.hideStudyModal();
            this.clara.ui.showToast(`Joined session with ${data.host_name}`);

        } catch (err) {
            this.clara.ui.hideLoading();
            this.clara.ui.showToast('Failed to join: ' + err.message, true);
        }
    }

    async loadStudyDocument() {
        // Get document info
        const infoRes = await fetch(`/study/document/${this.sessionCode}/info`);
        const info = await infoRes.json();

        if (info.error) {
            throw new Error(info.error);
        }

        // Set up state for the study document
        this.state.isStudySession = true;
        this.state.studySessionCode = this.sessionCode;
        this.state.viewerPageCount = info.page_count;
        this.state.viewerDocName = info.doc_name;

        // Load the first page
        this.clara.viewer.loadStudyPage(this.sessionCode, 0);
    }

    connectSocket() {
        return new Promise((resolve, reject) => {
            // Load socket.io client if not loaded
            if (typeof io === 'undefined') {
                const script = document.createElement('script');
                script.src = '/static/js/socket.io.min.js';
                script.onload = () => this.initSocket(resolve, reject);
                script.onerror = () => reject(new Error('Failed to load socket.io'));
                document.head.appendChild(script);
            } else {
                this.initSocket(resolve, reject);
            }
        });
    }

    initSocket(resolve, reject) {
        try {
            this.socket = io();

            this.socket.on('connect', () => {
                console.log('[StudySession] Connected to server');

                // Join the session room
                this.socket.emit('join_session', {
                    code: this.sessionCode,
                    name: this.userName,
                    is_host: this.isHost
                });

                resolve();
            });

            this.socket.on('connect_error', (err) => {
                console.error('[StudySession] Connection error:', err);
                reject(err);
            });

            // Session state received
            this.socket.on('session_state', (data) => {
                this.handleSessionState(data);
            });

            // Participant events
            this.socket.on('participant_joined', (data) => {
                this.participants = data.participants;
                this.updateParticipantsList();
                this.addSystemMessage(`${data.name} joined the session`);
            });

            this.socket.on('participant_left', (data) => {
                this.addSystemMessage(`${data.name} left the session`);
                // Refresh participant list on next state update
            });

            // Page sync
            this.socket.on('page_changed', (data) => {
                if (this.syncReading) {
                    this.clara.viewer.goToPage(data.page);
                    this.addSystemMessage(`${data.by} turned to page ${data.page + 1}`);
                }
            });

            // Reading sync
            this.socket.on('reading_sync', (data) => {
                if (this.syncReading) {
                    // Sync reading state
                    if (data.is_reading && !this.state.isPlaying) {
                        this.clara.reading.play();
                    } else if (!data.is_reading && this.state.isPlaying) {
                        this.clara.reading.pause();
                    }
                }
            });

            // Chat messages
            this.socket.on('new_chat_message', (data) => {
                this.addChatMessage(data);
            });

            // Session ended
            this.socket.on('session_ended', () => {
                this.clara.ui.showToast('The host ended the session');
                this.cleanup();
            });

            this.socket.on('error', (data) => {
                this.clara.ui.showToast(data.message, true);
            });

        } catch (err) {
            reject(err);
        }
    }

    handleSessionState(data) {
        this.participants = data.participants;
        this.chatHistory = data.chat_history;
        this.updateParticipantsList();

        // Render chat history
        this.chatHistory.forEach(msg => this.addChatMessage(msg, false));

        // Sync to current page if joining
        if (!this.isHost && this.syncReading) {
            const currentPage = data.shared_state.current_page;
            if (currentPage !== this.state.viewerCurrentPage) {
                this.clara.viewer.goToPage(currentPage);
            }
        }
    }

    updateParticipantsList() {
        const list = document.getElementById('participants-list');
        if (!list) return;

        list.innerHTML = '';

        this.participants.forEach(p => {
            const item = document.createElement('div');
            item.className = 'participant-item' + (p.is_host ? ' host' : '');
            item.innerHTML = `
                <span class="participant-name">${p.name}</span>
                ${p.is_host ? '<span class="host-badge">Host</span>' : ''}
                <span class="participant-page">Page ${p.page + 1}</span>
            `;
            list.appendChild(item);
        });

        // Update count
        const countEl = document.getElementById('participant-count');
        if (countEl) {
            countEl.textContent = this.participants.length;
        }
    }

    sendChatMessage() {
        const input = document.getElementById('study-chat-input');
        const message = input.value.trim();

        if (!message || !this.socket) return;

        this.socket.emit('chat_message', {
            code: this.sessionCode,
            message: message
        });

        input.value = '';
    }

    addChatMessage(data, scroll = true) {
        const chatMessages = document.getElementById('study-chat-messages');
        if (!chatMessages) return;

        const msgEl = document.createElement('div');

        if (data.type === 'clara_qa') {
            // Clara Q&A message
            msgEl.className = 'chat-message clara-qa';
            msgEl.innerHTML = `
                <div class="chat-header">
                    <span class="chat-name">${data.name}</span>
                    <span class="chat-badge">Asked Clara</span>
                </div>
                <div class="chat-question">Q: ${data.question}</div>
                <div class="chat-answer">A: ${data.answer}</div>
            `;
        } else {
            // Regular chat message
            msgEl.className = 'chat-message' + (data.is_host ? ' from-host' : '');
            msgEl.innerHTML = `
                <div class="chat-header">
                    <span class="chat-name">${data.name}</span>
                    ${data.is_host ? '<span class="host-badge">Host</span>' : ''}
                </div>
                <div class="chat-text">${this.escapeHtml(data.message)}</div>
            `;
        }

        chatMessages.appendChild(msgEl);

        if (scroll) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    addSystemMessage(text) {
        const chatMessages = document.getElementById('study-chat-messages');
        if (!chatMessages) return;

        const msgEl = document.createElement('div');
        msgEl.className = 'chat-message system';
        msgEl.innerHTML = `<div class="chat-system-text">${text}</div>`;
        chatMessages.appendChild(msgEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Called by reading module when page changes
    syncPageChange(page) {
        if (this.socket && this.sessionCode) {
            this.socket.emit('sync_page', {
                code: this.sessionCode,
                page: page
            });
        }
    }

    // Called by reading module when play/pause
    syncReadingState(isReading, wordIndex) {
        if (this.socket && this.sessionCode) {
            this.socket.emit('sync_reading', {
                code: this.sessionCode,
                is_reading: isReading,
                word_index: wordIndex
            });
        }
    }

    // Called when Clara answers a question
    shareClaraQA(question, answer) {
        if (this.socket && this.sessionCode) {
            this.socket.emit('clara_qa', {
                code: this.sessionCode,
                question: question,
                answer: answer
            });
        }
    }

    async leaveSession() {
        if (this.isHost) {
            if (!confirm('End the study session for everyone?')) {
                return;
            }

            try {
                await fetch(`/study/end/${this.sessionCode}`, { method: 'POST' });
            } catch (err) {
                console.error('Failed to end session:', err);
            }
        } else {
            this.socket?.emit('leave_session', { code: this.sessionCode });
        }

        this.cleanup();
        this.showStudyMenu();
        this.clara.ui.showToast('Left the study session');
    }

    cleanup() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        this.sessionCode = null;
        this.isHost = false;
        this.userName = '';
        this.participants = [];
        this.chatHistory = [];
        this.state.isStudySession = false;
        this.state.studySessionCode = null;

        // Clear chat
        const chatMessages = document.getElementById('study-chat-messages');
        if (chatMessages) {
            chatMessages.innerHTML = '';
        }
    }

    // Check if in active session
    isInSession() {
        return this.sessionCode !== null && this.socket?.connected;
    }

    // Copy session code to clipboard
    copySessionCode() {
        if (this.sessionCode) {
            navigator.clipboard.writeText(this.sessionCode);
            this.clara.ui.showToast('Session code copied!');
        }
    }
}
